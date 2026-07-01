import { auth } from "@/auth";
import { downloadDriveItem } from "@/lib/graph";
import { supabaseAdmin } from "@/lib/supabase-admin";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function safeFilenamePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/["\\]/g, "");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) {
    return new Response("Not signed in.", { status: 401 });
  }

  const { id } = await params;
  const { data: inspection, error } = await supabaseAdmin()
    .from("inspections")
    .select(
      "property_name, inspection_date, onedrive_drive_id, generated_doc_onedrive_id",
    )
    .eq("id", id)
    .single();

  if (error || !inspection) {
    return new Response("Inspection not found.", { status: 404 });
  }

  if (!inspection.generated_doc_onedrive_id) {
    return new Response("Generate the report before downloading it.", {
      status: 409,
    });
  }

  const docBytes = await downloadDriveItem(
    inspection.onedrive_drive_id,
    inspection.generated_doc_onedrive_id,
  );
  const filename = `Council Inspection Report - ${safeFilenamePart(
    inspection.property_name,
  )} - ${inspection.inspection_date}.docx`;

  return new Response(new Uint8Array(docBytes), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": contentDisposition(filename),
      "Content-Type": DOCX_MIME,
    },
  });
}
