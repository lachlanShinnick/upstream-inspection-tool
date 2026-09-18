import { contentDisposition } from "@/lib/downloadHeaders";
import { downloadDriveItemAppOnly } from "@/lib/graph";
import {
  renderReportDocx,
  renderReportPdfAppOnly,
  reportBaseName,
} from "@/lib/reportGeneration";
import { validateReviewToken } from "@/lib/reviewToken";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Rendering re-downloads every photo and, for PDF, does an extra
// upload-then-convert round trip through Graph — comfortably past the
// platform's 10s default. Raise the ceiling (60s is the max on Vercel Hobby).
export const maxDuration = 60;

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
    if (asPdf) {
      const { pdf, baseName } = await renderReportPdfAppOnly(scope.inspectionId);
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": contentDisposition(`${baseName}.pdf`),
          "Content-Type": "application/pdf",
        },
      });
    }

    const { buffer, inspection } = await renderReportDocx(
      scope.inspectionId,
      downloadDriveItemAppOnly,
    );
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": contentDisposition(
          `${reportBaseName(inspection)}.docx`,
        ),
        "Content-Type": DOCX_MIME,
      },
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Couldn't prepare the download.";
    console.error("[review download] failed:", message);
    return new Response(message, { status: 502 });
  }
}
