"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { polishComment } from "@/lib/commentPolish";
import { getAppOnlyGraphClient, getGraphClient } from "@/lib/graph";
import {
  INSPECTION_CONDITIONS,
  incomingDetailsToRow,
  validateIncomingDetails,
  type IncomingInspectionDetails,
  type InspectionCondition,
} from "@/lib/incomingInspection";
import { formatPropertyName } from "@/lib/propertyName";
import { reportTypeInfo } from "@/lib/reportTypes";
import {
  APPROVER_LABEL,
  approverEmails,
  approverEnvVar,
  isApprover,
  type Approver,
} from "@/lib/reviewApprovers";
import { validateReviewToken } from "@/lib/reviewToken";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type { Approver } from "@/lib/reviewApprovers";

function formatDateAU(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)}/${month}/${year}`;
}

/** A reviewer's edit to one action item's location + comment. */
export type ReviewEdit = {
  id: string;
  area: string;
  comment: string;
  condition?: InspectionCondition | null;
};

/** A reviewer's edit to one incident-report narrative note. */
export type NoteEdit = { id: string; text: string };

/**
 * Token-scoped twin of saveReview in inspect/[id]/generate/actions.ts — same
 * persistence logic, but gated by a valid review token instead of a session,
 * for the unauthenticated reviewer page. `noteEdits` only applies to incident
 * reports (the first-page narrative log).
 */
export async function saveReviewByToken(
  token: string,
  edits: ReviewEdit[],
  noteEdits: NoteEdit[] = [],
  incomingDetails?: IncomingInspectionDetails,
): Promise<{ saved: true }> {
  const scope = await validateReviewToken(token);
  if (!scope) throw new Error("This review link has expired.");

  const sb = supabaseAdmin();
  const { data: inspection } = await sb
    .from("inspections")
    .select("report_type")
    .eq("id", scope.inspectionId)
    .single();
  const isIncoming = inspection?.report_type === "incoming";

  for (const edit of edits) {
    const area = edit.area.trim();
    if (!area) throw new Error("Every item needs an area.");
    if (
      isIncoming &&
      (!edit.condition ||
        !INSPECTION_CONDITIONS.includes(edit.condition))
    ) {
      throw new Error("Every incoming inspection photo needs a condition.");
    }
    const { error } = await sb
      .from("action_items")
      .update({
        area,
        comment: edit.comment.trim(),
        ...(isIncoming ? { condition: edit.condition } : {}),
      })
      .eq("id", edit.id)
      .eq("inspection_id", scope.inspectionId);
    if (error) throw new Error(`Couldn't save changes: ${error.message}`);
  }

  if (incomingDetails) {
    if (!isIncoming) {
      throw new Error("Incoming inspection information is not valid here.");
    }
    const missing = validateIncomingDetails(incomingDetails);
    if (missing.length > 0) {
      throw new Error(`Complete the required information: ${missing.join(", ")}.`);
    }
    const { error } = await sb
      .from("incoming_inspection_details")
      .upsert(
        {
          inspection_id: scope.inspectionId,
          ...incomingDetailsToRow(incomingDetails),
        },
        { onConflict: "inspection_id" },
      );
    if (error) {
      throw new Error(`Couldn't save incoming inspection details: ${error.message}`);
    }
  }

  for (const edit of noteEdits) {
    const text = edit.text.trim();
    if (!text) throw new Error("Notes can't be blank.");
    const { error } = await sb
      .from("incident_notes")
      .update({ text })
      .eq("id", edit.id)
      .eq("inspection_id", scope.inspectionId);
    if (error) throw new Error(`Couldn't save notes: ${error.message}`);
  }

  revalidatePath(`/review/${token}`);
  return { saved: true };
}

/**
 * Send the existing live review link to a fixed internal approver. The token
 * supplies the inspection scope, so callers cannot choose another inspection
 * ID. No document is regenerated or attached: the recipient sees the edits
 * that saveReviewByToken persisted immediately before this action is called.
 */
export async function sendReviewForApprovalByToken(
  token: string,
  approver: Approver,
): Promise<{ sent: true }> {
  const scope = await validateReviewToken(token);
  if (!scope) throw new Error("This review link has expired.");
  if (!isApprover(approver)) throw new Error("Choose Dave or Jackie.");

  const recipients = approverEmails(approver);
  if (recipients.length === 0) {
    throw new Error(
      `No email configured for ${APPROVER_LABEL[approver]}. Set ${approverEnvVar(approver)} in .env.local.`,
    );
  }

  const sb = supabaseAdmin();
  const { data: inspection, error } = await sb
    .from("inspections")
    .select(
      "property_name, inspection_date, report_type, generated_doc_onedrive_id, user_id",
    )
    .eq("id", scope.inspectionId)
    .single();
  if (error || !inspection) throw new Error("Inspection not found.");
  if (!inspection.generated_doc_onedrive_id) {
    throw new Error("Generate the report before sending it for approval.");
  }

  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    throw new Error("Set APP_BASE_URL in .env.local to build the review link.");
  }

  const propertyName = formatPropertyName(inspection.property_name);
  const dateAU = formatDateAU(inspection.inspection_date);
  const report = reportTypeInfo(inspection.report_type);
  const reviewUrl = new URL(`/review/${token}`, appBaseUrl).toString();
  const subject = `${report.title} Ready — ${propertyName} — ${dateAU}`;
  const message = {
    subject,
    toRecipients: recipients.map((address) => ({
      emailAddress: { address },
    })),
    body: {
      contentType: "Text",
      content: `Hi,
The ${report.title.toLowerCase()} for ${propertyName} (${dateAU}) has been updated and is ready for your review and approval.

Open the live review to see the saved changes and continue editing: ${reviewUrl}

This link doesn't require a Microsoft sign-in and works for 30 days.
Thanks`,
    },
  };

  const session = await auth();
  if (session?.accessToken) {
    const client = await getGraphClient();
    await client.api("/me/sendMail").post({ message, saveToSentItems: true });
  } else {
    // A review link deliberately works without authentication. When it was
    // opened in a signed-out browser, send as the inspection's owner using the
    // app-only Graph client instead of forcing the reviewer through sign-in.
    const { data: inspector } = await sb
      .from("users")
      .select("email")
      .eq("id", inspection.user_id)
      .single();
    if (!inspector?.email) {
      throw new Error("The inspector doesn't have an email address configured.");
    }
    const client = await getAppOnlyGraphClient();
    await client
      .api(`/users/${encodeURIComponent(inspector.email)}/sendMail`)
      .post({ message, saveToSentItems: true });
  }

  return { sent: true };
}

/**
 * Fallback for the rare case ai_comment wasn't populated at capture time
 * (e.g. OpenAI was briefly down). Polishes `text` and persists the result to
 * ai_comment so it doesn't need regenerating again on a later visit.
 */
export async function regenerateSuggestion(
  token: string,
  itemId: string,
  text: string,
): Promise<string | null> {
  const scope = await validateReviewToken(token);
  if (!scope) throw new Error("This review link has expired.");

  const polished = await polishComment(text);
  if (!polished) return null;

  const { error } = await supabaseAdmin()
    .from("action_items")
    .update({ ai_comment: polished })
    .eq("id", itemId)
    .eq("inspection_id", scope.inspectionId);
  if (error) throw new Error(`Couldn't save suggestion: ${error.message}`);

  return polished;
}

/**
 * Same as {@link regenerateSuggestion}, for one incoming-inspection "Other
 * Comments" entry. These live in a jsonb array rather than their own column,
 * so caching the suggestion means reading the array back, setting aiText on the
 * matching entry and writing it out again. Only other_comments is touched, so a
 * concurrent save of the surrounding details can't be lost to this write.
 */
export async function regenerateCommentSuggestion(
  token: string,
  commentId: string,
  text: string,
): Promise<string | null> {
  const scope = await validateReviewToken(token);
  if (!scope) throw new Error("This review link has expired.");

  const polished = await polishComment(text);
  if (!polished) return null;

  const sb = supabaseAdmin();
  const { data: row, error: readErr } = await sb
    .from("incoming_inspection_details")
    .select("other_comments")
    .eq("inspection_id", scope.inspectionId)
    .maybeSingle();
  if (readErr) throw new Error(`Couldn't save suggestion: ${readErr.message}`);

  const stored = Array.isArray(row?.other_comments)
    ? (row.other_comments as Record<string, unknown>[])
    : [];
  let matched = false;
  const next = stored.map((entry) => {
    const item = entry && typeof entry === "object" ? entry : {};
    if (item.id !== commentId) return entry;
    matched = true;
    return { ...item, aiText: polished };
  });

  // A comment the reviewer just added isn't in the stored array yet. The
  // suggestion still goes back to them, and persists with their next save.
  if (matched) {
    const { error } = await sb
      .from("incoming_inspection_details")
      .update({ other_comments: next, updated_at: new Date().toISOString() })
      .eq("inspection_id", scope.inspectionId);
    if (error) throw new Error(`Couldn't save suggestion: ${error.message}`);
  }

  return polished;
}

/** Same as {@link regenerateSuggestion}, for an incident-report note. */
export async function regenerateNoteSuggestion(
  token: string,
  noteId: string,
  text: string,
): Promise<string | null> {
  const scope = await validateReviewToken(token);
  if (!scope) throw new Error("This review link has expired.");

  const polished = await polishComment(text);
  if (!polished) return null;

  const { error } = await supabaseAdmin()
    .from("incident_notes")
    .update({ ai_text: polished })
    .eq("id", noteId)
    .eq("inspection_id", scope.inspectionId);
  if (error) throw new Error(`Couldn't save suggestion: ${error.message}`);

  return polished;
}
