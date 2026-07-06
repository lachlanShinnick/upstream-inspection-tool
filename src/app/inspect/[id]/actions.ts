"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { auth } from "@/auth";
import { polishComment } from "@/lib/commentPolish";
import { uploadFileToFolder } from "@/lib/graph";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** What the upload action returns — OneDrive identity only. */
export type UploadedPhoto = {
  localUuid: string;
  onedriveFileId: string;
  filename: string;
};

/** A photo collected for a report item; dimensions are known client-side. */
export type ReportPhoto = {
  localUuid: string;
  onedriveFileId?: string;
  filename?: string;
  width: number;
  height: number;
  takenAt: string;
};

/** Capture timestamp for filenames: YYYY-MM-DD_HHMMSS in Adelaide time. */
function adelaideStamp() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Adelaide",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}_${get("hour")}${get("minute")}${get("second")}`;
}

/**
 * Resize-on-device JPEG is uploaded straight to the inspection's dated OneDrive
 * subfolder. No Supabase row — these only become report photos once an action
 * item is saved.
 */
export async function uploadInspectionPhoto(
  inspectionId: string,
  localUuid: string,
  takenAt: string,
  formData: FormData,
): Promise<UploadedPhoto> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  if (!localUuid) throw new Error("Missing local photo id.");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No photo supplied.");

  const { data: inspection, error } = await supabaseAdmin()
    .from("inspections")
    .select("onedrive_drive_id, onedrive_subfolder_id")
    .eq("id", inspectionId)
    .single();
  if (error || !inspection) throw new Error("Inspection not found.");

  const stamp = takenAt ? takenAt.replace(/[-:]/g, "").slice(0, 15) : adelaideStamp();
  const filename = `${stamp}_${localUuid.slice(0, 8)}.jpg`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const item = await uploadFileToFolder(
    inspection.onedrive_drive_id,
    inspection.onedrive_subfolder_id,
    filename,
    bytes,
    "image/jpeg",
  );

  const { error: patchErr } = await supabaseAdmin()
    .from("photos")
    .update({
      onedrive_file_id: item.id,
      filename: item.name,
      sync_status: "uploaded",
    })
    .eq("local_uuid", localUuid);
  if (patchErr) {
    throw new Error(`Photo uploaded, but couldn't mark it synced: ${patchErr.message}`);
  }

  return { localUuid, onedriveFileId: item.id, filename: item.name };
}

/**
 * Persist a reported action item plus its photos. The OneDrive files already
 * exist (uploaded at capture); here we record them in Supabase.
 */
export async function createReportedItem(
  inspectionId: string,
  localUuid: string,
  area: string,
  comment: string,
  photos: ReportPhoto[],
): Promise<{ id: string; area: string; comment: string }> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  if (!localUuid) throw new Error("Missing local action item id.");

  const trimmedArea = area.trim();
  if (!trimmedArea) throw new Error("Area is required.");

  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("action_items")
    .select("id, area, comment")
    .eq("local_uuid", localUuid)
    .maybeSingle();

  // sort_order = position at the end of the current list.
  const { count } = await sb
    .from("action_items")
    .select("id", { count: "exact", head: true })
    .eq("inspection_id", inspectionId);

  let item = existing;
  if (!item) {
    const { data: inserted, error: itemErr } = await sb
      .from("action_items")
      .insert({
        inspection_id: inspectionId,
        local_uuid: localUuid,
        area: trimmedArea,
        comment: comment.trim(),
        original_comment: comment.trim(),
        sort_order: count ?? 0,
      })
      .select("id, area, comment")
      .single();
    if (itemErr || !inserted) {
      throw new Error(`Failed to save action item: ${itemErr?.message ?? "unknown"}`);
    }
    item = inserted;
  }

  if (photos.length > 0) {
    const rows = photos.map((p) => ({
      action_item_id: item.id,
      onedrive_file_id: p.onedriveFileId ?? null,
      filename: p.filename ?? null,
      local_uuid: p.localUuid,
      sync_status: p.onedriveFileId ? "uploaded" : "pending",
      taken_at: p.takenAt,
      width: p.width,
      height: p.height,
    }));
    const { error: photoErr } = await sb
      .from("photos")
      .upsert(rows, { onConflict: "local_uuid" });
    if (photoErr) {
      throw new Error(`Failed to save photos: ${photoErr.message}`);
    }
  }

  // Polish the wording in the background so the inspector's save doesn't wait
  // on OpenAI. Stored on ai_comment for the reviewer page to show instantly;
  // `comment` itself is untouched here (still the as-typed original) — it
  // only changes when someone explicitly saves an edit from a review screen.
  const itemId = item.id;
  const original = item.comment;
  if (!existing) {
    after(async () => {
      const polished = await polishComment(original);
      if (!polished) return;
      const { error } = await supabaseAdmin()
        .from("action_items")
        .update({ ai_comment: polished })
        .eq("id", itemId);
      if (error) {
        console.error("[createReportedItem] failed to save ai_comment:", error.message);
      }
    });
  }

  revalidatePath(`/inspect/${inspectionId}`);
  return item;
}

/**
 * Persist one incident-report narrative note. Idempotent by local_uuid so the
 * offline queue can retry safely, mirroring createReportedItem.
 */
export async function createIncidentNote(
  inspectionId: string,
  localUuid: string,
  text: string,
): Promise<{ id: string; text: string }> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  if (!localUuid) throw new Error("Missing local note id.");

  const trimmed = text.trim();
  if (!trimmed) throw new Error("Note text is required.");

  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("incident_notes")
    .select("id, text")
    .eq("local_uuid", localUuid)
    .maybeSingle();
  if (existing) return existing;

  // sort_order = position at the end of the current list.
  const { count } = await sb
    .from("incident_notes")
    .select("id", { count: "exact", head: true })
    .eq("inspection_id", inspectionId);

  const { data: inserted, error } = await sb
    .from("incident_notes")
    .insert({
      inspection_id: inspectionId,
      local_uuid: localUuid,
      text: trimmed,
      original_text: trimmed,
      sort_order: count ?? 0,
    })
    .select("id, text")
    .single();
  if (error || !inserted) {
    throw new Error(`Failed to save note: ${error?.message ?? "unknown"}`);
  }

  revalidatePath(`/inspect/${inspectionId}`);
  return inserted;
}

/**
 * Remove a photo from a report item — deletes the Supabase row only. The
 * OneDrive file is intentionally left in place (Upstream owns the source files).
 */
export async function deletePhoto(
  photoId: string,
  inspectionId: string,
): Promise<void> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const { error } = await supabaseAdmin().from("photos").delete().eq("id", photoId);
  if (error) throw new Error(`Failed to remove photo: ${error.message}`);

  revalidatePath(`/inspect/${inspectionId}`);
}
