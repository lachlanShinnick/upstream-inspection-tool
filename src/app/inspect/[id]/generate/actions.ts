"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { downloadDriveItem, getGraphClient } from "@/lib/graph";
import { generateReport } from "@/lib/reportGeneration";
import { supabaseAdmin } from "@/lib/supabase-admin";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function formatDateAU(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${m}/${y}`;
}

export async function runGenerate(
  inspectionId: string,
): Promise<{ docOnedriveId: string; docWebUrl: string }> {
  const result = await generateReport(inspectionId);
  revalidatePath(`/inspect/${inspectionId}/generate`);
  revalidatePath("/dashboard");
  return result;
}

/**
 * Create an Outlook draft to Dave with the generated report attached, and
 * return its webLink so the inspector can review and send manually.
 */
export async function sendForReview(
  inspectionId: string,
): Promise<{ webLink: string }> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  // Comma- (or semicolon-) separated list of recipients.
  const recipients = (process.env.REVIEW_RECIPIENT_EMAIL ?? "")
    .split(/[,;]/)
    .map((r) => r.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    throw new Error(
      "No review recipient configured. Set REVIEW_RECIPIENT_EMAIL in .env.local.",
    );
  }

  const { data: inspection, error } = await supabaseAdmin()
    .from("inspections")
    .select(
      "property_name, inspection_date, onedrive_drive_id, generated_doc_onedrive_id",
    )
    .eq("id", inspectionId)
    .single();
  if (error || !inspection) throw new Error("Inspection not found.");
  if (!inspection.generated_doc_onedrive_id) {
    throw new Error("Generate the report before sending it for review.");
  }

  const docBytes = await downloadDriveItem(
    inspection.onedrive_drive_id,
    inspection.generated_doc_onedrive_id,
  );

  const dateAU = formatDateAU(inspection.inspection_date);
  const subject = `Council Inspection Report — ${inspection.property_name} — ${dateAU}`;
  const filename = `Council Inspection Report - ${inspection.property_name.replace(
    /[\\/:*?"<>|]/g,
    "-",
  )} - ${inspection.inspection_date}.docx`;

  const client = await getGraphClient();
  const draft = await client.api("/me/messages").post({
    subject,
    toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
    body: {
      contentType: "Text",
      content: `Hi,\n\nPlease find attached the council routine inspection report for ${inspection.property_name} (${dateAU}) for review.\n\nThanks`,
    },
    attachments: [
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: filename,
        contentType: DOCX_MIME,
        contentBytes: docBytes.toString("base64"),
      },
    ],
  });

  return { webLink: draft.webLink as string };
}
