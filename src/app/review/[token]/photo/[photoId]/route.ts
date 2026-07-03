import { downloadDriveItemAppOnly } from "@/lib/graph";
import { validateReviewToken } from "@/lib/reviewToken";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Token-scoped twin of /inspect/[id]/photo/[photoId]/route.ts, for the
 * unauthenticated reviewer page — same proxy-the-bytes approach (never expose
 * a Graph token/URL to the browser), but access is gated by a valid review
 * token instead of a signed-in session, and Graph calls use the app-only
 * client since there's no reviewer session to draw a token from.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; photoId: string }> },
) {
  const { token, photoId } = await params;
  const scope = await validateReviewToken(token);
  if (!scope) {
    return new Response("This link has expired or is invalid.", {
      status: 404,
    });
  }

  const sb = supabaseAdmin();

  const { data: photo, error } = await sb
    .from("photos")
    .select("onedrive_file_id, action_items!inner(inspection_id)")
    .eq("id", photoId)
    .maybeSingle();

  const belongsToInspection = Array.isArray(photo?.action_items)
    ? photo?.action_items.some((a) => a.inspection_id === scope.inspectionId)
    : (photo?.action_items as { inspection_id: string } | undefined)
        ?.inspection_id === scope.inspectionId;

  if (error || !photo || !belongsToInspection) {
    return new Response("Photo not found.", { status: 404 });
  }
  if (!photo.onedrive_file_id) {
    return new Response("Photo is still syncing.", { status: 409 });
  }

  const { data: inspection } = await sb
    .from("inspections")
    .select("onedrive_drive_id")
    .eq("id", scope.inspectionId)
    .single();
  if (!inspection) {
    return new Response("Inspection not found.", { status: 404 });
  }

  try {
    const bytes = await downloadDriveItemAppOnly(
      inspection.onedrive_drive_id,
      photo.onedrive_file_id,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error(
      "[review photo] app-only Graph download failed:",
      e instanceof Error ? e.message : e,
    );
    return new Response("Couldn't load photo.", { status: 502 });
  }
}
