import { auth } from "@/auth";
import { contentDisposition, safeFilenamePart } from "@/lib/downloadHeaders";
import { downloadDriveItem, downloadDriveItemAsPdf } from "@/lib/graph";
import { supabaseAdmin } from "@/lib/supabase-admin";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) {
    return new Response("Not signed in.", { status: 401 });
  }

  const asPdf =
    new URL(request.url).searchParams.get("format")?.toLowerCase() === "pdf";

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

  const baseName = `Council Inspection Report - ${safeFilenamePart(
    inspection.property_name,
  )} - ${inspection.inspection_date}`;

  try {
    if (asPdf) {
      const pdfBytes = await downloadDriveItemAsPdf(
        inspection.onedrive_drive_id,
        inspection.generated_doc_onedrive_id,
      );
      return new Response(new Uint8Array(pdfBytes), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": contentDisposition(`${baseName}.pdf`),
          "Content-Type": "application/pdf",
        },
      });
    }

    const docBytes = await downloadDriveItem(
      inspection.onedrive_drive_id,
      inspection.generated_doc_onedrive_id,
    );
    return new Response(new Uint8Array(docBytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": contentDisposition(`${baseName}.docx`),
        "Content-Type": DOCX_MIME,
      },
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Couldn't prepare the download.";
    return new Response(message, { status: 502 });
  }
}
