import { auth } from "@/auth";
import { downloadDriveItem } from "@/lib/graph";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Stream an inspection photo's bytes from OneDrive behind our own auth, so the
 * review screen can show thumbnails without exposing a Graph token to the
 * browser. The photo must belong to the inspection in the URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const session = await auth();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const { id, photoId } = await params;
  const sb = supabaseAdmin();

  const { data: photo, error } = await sb
    .from("photos")
    .select("onedrive_file_id, action_items!inner(inspection_id)")
    .eq("id", photoId)
    .maybeSingle();

  const belongsToInspection =
    // action_items!inner may come back as an object or a single-element array
    // depending on the relationship inference; handle both.
    Array.isArray(photo?.action_items)
      ? photo?.action_items.some((a) => a.inspection_id === id)
      : (photo?.action_items as { inspection_id: string } | undefined)
          ?.inspection_id === id;

  if (error || !photo || !belongsToInspection) {
    return new Response("Photo not found.", { status: 404 });
  }
  if (!photo.onedrive_file_id) {
    return new Response("Photo is still syncing.", { status: 409 });
  }

  const { data: inspection } = await sb
    .from("inspections")
    .select("onedrive_drive_id")
    .eq("id", id)
    .single();
  if (!inspection) return new Response("Inspection not found.", { status: 404 });

  try {
    const bytes = await downloadDriveItem(
      inspection.onedrive_drive_id,
      photo.onedrive_file_id,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        // Immutable content keyed by a stable id — cache in the browser.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Couldn't load photo.", { status: 502 });
  }
}
