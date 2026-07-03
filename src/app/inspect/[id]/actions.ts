"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { auth } from "@/auth";
import { polishComment } from "@/lib/commentPolish";
import { uploadFileToFolder } from "@/lib/graph";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** What the upload action returns — OneDrive identity only. */
export type UploadedPhoto = { onedriveFileId: string; filename: string };

/** A photo collected for a report item; dimensions are known client-side. */
export type ReportPhoto = UploadedPhoto & { width: number; height: number };

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
  formData: FormData,
): Promise<UploadedPhoto> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No photo supplied.");

  const { data: inspection, error } = await supabaseAdmin()
    .from("inspections")
    .select("onedrive_drive_id, onedrive_subfolder_id")
    .eq("id", inspectionId)
    .single();
  if (error || !inspection) throw new Error("Inspection not found.");

  const filename = `${adelaideStamp()}_${crypto.randomUUID().slice(0, 8)}.jpg`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const item = await uploadFileToFolder(
    inspection.onedrive_drive_id,
    inspection.onedrive_subfolder_id,
    filename,
    bytes,
    "image/jpeg",
  );

  return { onedriveFileId: item.id, filename: item.name };
}

/**
 * Persist a reported action item plus its photos. The OneDrive files already
 * exist (uploaded at capture); here we record them in Supabase.
 */
export async function createReportedItem(
  inspectionId: string,
  area: string,
  comment: string,
  photos: ReportPhoto[],
): Promise<{ id: string; area: string; comment: string }> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const trimmedArea = area.trim();
  if (!trimmedArea) throw new Error("Area is required.");

  const sb = supabaseAdmin();

  // sort_order = position at the end of the current list.
  const { count } = await sb
    .from("action_items")
    .select("id", { count: "exact", head: true })
    .eq("inspection_id", inspectionId);

  const { data: item, error: itemErr } = await sb
    .from("action_items")
    .insert({
      inspection_id: inspectionId,
      area: trimmedArea,
      comment: comment.trim(),
      original_comment: comment.trim(),
      sort_order: count ?? 0,
    })
    .select("id, area, comment")
    .single();
  if (itemErr || !item) {
    throw new Error(`Failed to save action item: ${itemErr?.message ?? "unknown"}`);
  }

  if (photos.length > 0) {
    const takenAt = new Date().toISOString();
    const rows = photos.map((p) => ({
      action_item_id: item.id,
      onedrive_file_id: p.onedriveFileId,
      filename: p.filename,
      local_uuid: crypto.randomUUID(),
      sync_status: "uploaded",
      taken_at: takenAt,
      width: p.width,
      height: p.height,
    }));
    const { error: photoErr } = await sb.from("photos").insert(rows);
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

  revalidatePath(`/inspect/${inspectionId}`);
  return item;
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
