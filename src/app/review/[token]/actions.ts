"use server";

import { revalidatePath } from "next/cache";
import { polishComment } from "@/lib/commentPolish";
import {
  INSPECTION_CONDITIONS,
  incomingDetailsToRow,
  validateIncomingDetails,
  type IncomingInspectionDetails,
  type InspectionCondition,
} from "@/lib/incomingInspection";
import { validateReviewToken } from "@/lib/reviewToken";
import { supabaseAdmin } from "@/lib/supabase-admin";

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
 * Polish one incoming-inspection "Other Comments" entry.
 *
 * Unlike action items and notes there's nowhere to persist this: comments live
 * in a jsonb array on incoming_inspection_details, and writing back would mean
 * a read-modify-write that could clobber the reviewer's other unsaved edits.
 * The suggestion is returned for the reviewer to accept, and becomes the
 * comment's own text when they save.
 */
export async function regenerateCommentSuggestion(
  token: string,
  text: string,
): Promise<string | null> {
  const scope = await validateReviewToken(token);
  if (!scope) throw new Error("This review link has expired.");

  return polishComment(text);
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
