"use server";

import { revalidatePath } from "next/cache";
import { polishComment } from "@/lib/commentPolish";
import { validateReviewToken } from "@/lib/reviewToken";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** A reviewer's edit to one action item's location + comment. */
export type ReviewEdit = { id: string; area: string; comment: string };

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
): Promise<{ saved: true }> {
  const scope = await validateReviewToken(token);
  if (!scope) throw new Error("This review link has expired.");

  const sb = supabaseAdmin();
  for (const edit of edits) {
    const area = edit.area.trim();
    if (!area) throw new Error("Every item needs an area.");
    const { error } = await sb
      .from("action_items")
      .update({ area, comment: edit.comment.trim() })
      .eq("id", edit.id)
      .eq("inspection_id", scope.inspectionId);
    if (error) throw new Error(`Couldn't save changes: ${error.message}`);
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
