"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { polishComment } from "@/lib/commentPolish";
import { getGraphClient } from "@/lib/graph";
import { formatPropertyName } from "@/lib/propertyName";
import { generateReport } from "@/lib/reportGeneration";
import { mintOrReuseReviewToken } from "@/lib/reviewToken";
import { supabaseAdmin } from "@/lib/supabase-admin";

function formatDateAU(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${m}/${y}`;
}

/** A reviewer's edit to one action item's location + comment. */
export type ReviewEdit = { id: string; area: string; comment: string };

/**
 * Persist the reviewer's edits to each action item's location (area) and
 * comment before the report is generated. Only rows belonging to this
 * inspection are touched.
 */
export async function saveReview(
  inspectionId: string,
  edits: ReviewEdit[],
): Promise<{ saved: true }> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const sb = supabaseAdmin();
  for (const edit of edits) {
    const area = edit.area.trim();
    if (!area) throw new Error("Every item needs an area.");
    const { error } = await sb
      .from("action_items")
      .update({ area, comment: edit.comment.trim() })
      .eq("id", edit.id)
      .eq("inspection_id", inspectionId);
    if (error) throw new Error(`Couldn't save changes: ${error.message}`);
  }

  revalidatePath(`/inspect/${inspectionId}/generate`);
  return { saved: true };
}

/**
 * Ask OpenAI (o4-mini) to tidy one comment's grammar/professionalism, on demand
 * from the review screen. Returns null when nothing better is available, so the
 * UI can just keep the reviewer's text.
 */
export async function suggestComment(text: string): Promise<string | null> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  return polishComment(text);
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
 * Email Dave (the configured reviewer) a magic link to the unauthenticated
 * review page for this inspection, and save a copy to the sender's Sent Items.
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
    .select("property_name, inspection_date, generated_doc_onedrive_id")
    .eq("id", inspectionId)
    .single();
  if (error || !inspection) throw new Error("Inspection not found.");
  if (!inspection.generated_doc_onedrive_id) {
    throw new Error("Generate the report before sending it for review.");
  }

  const dateAU = formatDateAU(inspection.inspection_date);
  const propertyName = formatPropertyName(inspection.property_name);
  const subject = `Council Inspection Report Ready — ${propertyName} — ${dateAU}`;

  const token = await mintOrReuseReviewToken(inspectionId);
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    throw new Error("Set APP_BASE_URL in .env.local to build the review link.");
  }
  const reviewUrl = new URL(`/review/${token}`, appBaseUrl).toString();

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
The council routine inspection report for ${propertyName} (${dateAU}) is ready for your review.

Review, edit and download it here: ${reviewUrl}

This link doesn't require a Microsoft sign-in and works for 30 days.
Thanks`,
      },
    },
    saveToSentItems: true,
  });
  return { sent: true };
}
