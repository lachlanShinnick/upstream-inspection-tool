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
 * Email Dave (the configured reviewer) that the generated report is ready, and
 * save a copy to the sender's Sent Items.
 */
export async function sendForReview(
  inspectionId: string,
): Promise<{ sent: true }> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
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

  const dateAU = formatDateAU(inspection.inspection_date);
  const subject = `Council Inspection Report Ready — ${inspection.property_name} — ${dateAU}`;
  const client = await getGraphClient();
  await client.api("/me/sendMail").post({
    message: {
      subject,
      toRecipients: recipients.map((address) => ({
        emailAddress: { address },
      })),

      body: {
        contentType: "Text",
        content: `Hi,
The council routine inspection report for ${inspection.property_name} (${dateAU}) has been generated and uploaded to the inspection folder in OneDrive.
Thanks`,
      },
    },
    saveToSentItems: true,
  });
  return { sent: true };
}
