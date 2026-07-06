"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Card } from "@/app/review/ui";
import {
  regenerateNoteSuggestion,
  regenerateSuggestion,
  saveReviewByToken,
} from "./actions";

export type ReviewPhoto = { id: string; filename: string };

export type ReviewItem = {
  id: string;
  area: string;
  comment: string;
  original_comment: string | null;
  ai_comment: string | null;
  photos: ReviewPhoto[];
};

/** Incident reports only: one narrative note from the first-page log. */
export type ReviewNote = {
  id: string;
  text: string;
  original_text: string | null;
  ai_text: string | null;
};

type Source = "original" | "ai" | "custom";

/**
 * Which wording a comment currently matches, so the pill row reflects reality
 * instead of tracked state that could drift from what's actually in the box.
 */
function sourceOf(
  comment: string,
  original: string | null,
  ai: string | null,
): Source {
  if (ai && comment === ai) return "ai";
  if (original && comment === original) return "original";
  return "custom";
}

export function ReviewEditor({
  token,
  items,
  notes = [],
  isIncident = false,
}: {
  token: string;
  items: ReviewItem[];
  notes?: ReviewNote[];
  isIncident?: boolean;
}) {
  const [edits, setEdits] = useState(
    () =>
      new Map(
        items.map((item) => {
          // A fresh, untouched item's comment equals its original wording —
          // in that case default the box to the AI suggestion (if one's
          // ready) as a friendlier starting point. Anything already diverged
          // (a prior save) is left exactly as saved.
          const comment =
            item.comment === item.original_comment && item.ai_comment
              ? item.ai_comment
              : item.comment;
          return [item.id, { area: item.area, comment }];
        }),
      ),
  );
  const [aiText, setAiText] = useState(
    () => new Map(items.map((item) => [item.id, item.ai_comment])),
  );
  const [noteEdits, setNoteEdits] = useState(
    () =>
      new Map(
        notes.map((note) => {
          // Same default as items: an untouched note starts on the AI
          // suggestion when one is ready; anything already edited stays as saved.
          const text =
            note.text === note.original_text && note.ai_text
              ? note.ai_text
              : note.text;
          return [note.id, text];
        }),
      ),
  );
  const [noteAiText, setNoteAiText] = useState(
    () => new Map(notes.map((note) => [note.id, note.ai_text])),
  );
  const [noteRegenerating, setNoteRegenerating] = useState<Set<string>>(new Set());
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  function updateEdit(id: string, field: "area" | "comment", value: string) {
    setEdits((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      if (current) next.set(id, { ...current, [field]: value });
      return next;
    });
    setSavedNote(null);
  }

  function chooseOriginal(item: ReviewItem) {
    if (item.original_comment) updateEdit(item.id, "comment", item.original_comment);
  }

  async function chooseAi(item: ReviewItem) {
    const known = aiText.get(item.id);
    if (known) {
      updateEdit(item.id, "comment", known);
      return;
    }
    setRegenerating((prev) => new Set(prev).add(item.id));
    setError(null);
    try {
      const current = edits.get(item.id)?.comment ?? item.comment;
      const generated = await regenerateSuggestion(token, item.id, current);
      if (generated) {
        setAiText((prev) => new Map(prev).set(item.id, generated));
        updateEdit(item.id, "comment", generated);
      } else {
        setError("No AI suggestion could be generated for this item.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate a suggestion.");
    } finally {
      setRegenerating((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  function updateNote(id: string, value: string) {
    setNoteEdits((prev) => new Map(prev).set(id, value));
    setSavedNote(null);
  }

  async function chooseNoteAi(note: ReviewNote) {
    const known = noteAiText.get(note.id);
    if (known) {
      updateNote(note.id, known);
      return;
    }
    setNoteRegenerating((prev) => new Set(prev).add(note.id));
    setError(null);
    try {
      const current = noteEdits.get(note.id) ?? note.text;
      const generated = await regenerateNoteSuggestion(token, note.id, current);
      if (generated) {
        setNoteAiText((prev) => new Map(prev).set(note.id, generated));
        updateNote(note.id, generated);
      } else {
        setError("No AI suggestion could be generated for this note.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate a suggestion.");
    } finally {
      setNoteRegenerating((prev) => {
        const next = new Set(prev);
        next.delete(note.id);
        return next;
      });
    }
  }

  function save() {
    setError(null);
    setSavedNote(null);
    startSave(async () => {
      try {
        const payload = Array.from(edits, ([id, edit]) => ({ id, ...edit }));
        const notePayload = Array.from(noteEdits, ([id, text]) => ({ id, text }));
        await saveReviewByToken(token, payload, notePayload);
        setSavedNote("Changes saved.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save changes.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {notes.length > 0 && (
        <Card>
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
            Incident log
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            These notes flow through the report’s first page in order.
          </p>
          <div className="mt-4 space-y-4">
            {notes.map((note, i) => {
              const text = noteEdits.get(note.id) ?? note.text;
              const ai = noteAiText.get(note.id) ?? null;
              const isRegenerating = noteRegenerating.has(note.id);
              const active = sourceOf(text, note.original_text, ai);
              return (
                <div key={note.id}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                      Note {i + 1}
                    </p>
                    <div
                      role="radiogroup"
                      aria-label="Wording source"
                      className="inline-flex overflow-hidden rounded-md border border-black/[.12] dark:border-white/[.18]"
                    >
                      <PillButton
                        active={active === "original"}
                        disabled={!note.original_text}
                        onClick={() =>
                          note.original_text && updateNote(note.id, note.original_text)
                        }
                      >
                        Original
                      </PillButton>
                      <PillButton
                        active={active === "ai"}
                        busy={isRegenerating}
                        onClick={() => chooseNoteAi(note)}
                      >
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                        {isRegenerating ? "Generating…" : "AI suggestion"}
                      </PillButton>
                      <PillButton active={active === "custom"} disabled>
                        Custom
                      </PillButton>
                    </div>
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => updateNote(note.id, e.target.value)}
                    rows={3}
                    className="mt-1 block w-full rounded-lg border border-black/[.12] bg-white px-3 py-2 text-sm leading-6 text-[#111817] dark:border-white/[.18] dark:bg-zinc-900 dark:text-zinc-50"
                  />
                  {note.original_text && active !== "original" && (
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      Original: {note.original_text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {items.map((item, i) => {
        const edit = edits.get(item.id) ?? { area: item.area, comment: item.comment };
        const ai = aiText.get(item.id) ?? null;
        const isRegenerating = regenerating.has(item.id);
        const active = sourceOf(edit.comment, item.original_comment, ai);

        return (
          <Card key={item.id}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                {isIncident ? "Photo" : "Item"} {i + 1}
              </h2>
            </div>

            {item.photos.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.photos.map((photo) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={photo.id}
                    src={`/review/${token}/photo/${photo.id}`}
                    alt={photo.filename}
                    className="h-24 w-24 rounded-md border border-black/[.08] object-cover dark:border-white/[.12]"
                  />
                ))}
              </div>
            )}

            <label className="mt-4 block text-sm font-semibold text-[#111817] dark:text-zinc-50">
              Area
              <input
                type="text"
                value={edit.area}
                onChange={(e) => updateEdit(item.id, "area", e.target.value)}
                className="mt-1 block w-full rounded-lg border border-black/[.12] bg-white px-3 py-2 text-sm text-[#111817] dark:border-white/[.18] dark:bg-zinc-900 dark:text-zinc-50"
              />
            </label>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  {isIncident ? "Description" : "Comment"}
                </p>
                <div
                  role="radiogroup"
                  aria-label="Wording source"
                  className="inline-flex overflow-hidden rounded-md border border-black/[.12] dark:border-white/[.18]"
                >
                  <PillButton
                    active={active === "original"}
                    disabled={!item.original_comment}
                    onClick={() => chooseOriginal(item)}
                  >
                    Original
                  </PillButton>
                  <PillButton
                    active={active === "ai"}
                    busy={isRegenerating}
                    onClick={() => chooseAi(item)}
                  >
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    {isRegenerating ? "Generating…" : "AI suggestion"}
                  </PillButton>
                  <PillButton active={active === "custom"} disabled>
                    Custom
                  </PillButton>
                </div>
              </div>
              <textarea
                value={edit.comment}
                onChange={(e) => updateEdit(item.id, "comment", e.target.value)}
                rows={4}
                className="mt-2 block w-full rounded-lg border border-black/[.12] bg-white px-3 py-2 text-sm leading-6 text-[#111817] dark:border-white/[.18] dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            {item.original_comment && active !== "original" && (
              <div className="mt-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  Original wording
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  {item.original_comment}
                </p>
              </div>
            )}
          </Card>
        );
      })}

      <div className="sticky bottom-4 flex items-center gap-3 rounded-lg border border-black/[.08] bg-white/95 p-4 shadow-sm backdrop-blur dark:border-white/[.12] dark:bg-zinc-950/95">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#0072c6] px-5 text-sm font-semibold text-white shadow-sm shadow-[#0072c6]/20 transition-colors hover:bg-[#005ea2] disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {savedNote && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{savedNote}</p>
        )}
        <p className="ml-auto text-sm text-zinc-500">
          Downloads reflect the last saved version.
        </p>
      </div>
    </div>
  );
}

function PillButton({
  active,
  disabled,
  busy,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled || busy}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-50 ${
        active
          ? "bg-[#0072c6] text-white"
          : "bg-white text-zinc-600 hover:bg-black/[.04] dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-white/[.08]"
      }`}
    >
      {children}
    </button>
  );
}
