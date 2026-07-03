import { contentDisposition, safeFilenamePart } from "@/lib/downloadHeaders";
import {
  downloadDriveItemAppOnly,
  downloadDriveItemAsPdfAppOnly,
  uploadFileToFolderAppOnly,
} from "@/lib/graph";
import { renderReportDocx } from "@/lib/reportGeneration";
import { validateReviewToken } from "@/lib/reviewToken";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Token-scoped download for the reviewer page. Unlike the inspector's static
 * download route, this always re-renders from the inspection's *current*
 * action_items/photos so it reflects whatever the reviewer has saved.
 * Deliberately never touches inspections.generated_doc_onedrive_id — the
 * inspector's canonical generated doc stays independent of this path.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const scope = await validateReviewToken(token);
  if (!scope) {
    return new Response("This link has expired or is invalid.", {
      status: 404,
    });
  }

  const asPdf =
    new URL(request.url).searchParams.get("format")?.toLowerCase() === "pdf";

  try {
    const { buffer, inspection } = await renderReportDocx(
      scope.inspectionId,
      downloadDriveItemAppOnly,
    );
    const baseName = `Council Inspection Report - ${safeFilenamePart(
      inspection.property_name,
    )} - ${inspection.inspection_date}`;

    if (!asPdf) {
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": contentDisposition(`${baseName}.docx`),
          "Content-Type": DOCX_MIME,
        },
      });
    }

    // Graph's ?format=pdf conversion only works on a file that already
    // exists in a drive, so upload the freshly-rendered buffer to a fixed
    // scratch filename (re-uploading overwrites in place — no clutter/growth
    // per download) and convert that.
    const scratchName = `Review Draft (working copy, do not use) - ${baseName}.docx`;
    const uploaded = await uploadFileToFolderAppOnly(
      inspection.onedrive_drive_id,
      inspection.onedrive_subfolder_id,
      scratchName,
      buffer,
      DOCX_MIME,
    );
    const pdfBytes = await downloadDriveItemAsPdfAppOnly(
      inspection.onedrive_drive_id,
      uploaded.id,
    );
    return new Response(new Uint8Array(pdfBytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": contentDisposition(`${baseName}.pdf`),
        "Content-Type": "application/pdf",
      },
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Couldn't prepare the download.";
    return new Response(message, { status: 502 });
  }
}
