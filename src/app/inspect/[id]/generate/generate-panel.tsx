"use client";

import { useState, useTransition } from "react";
import { Download, FileText, Mail, RefreshCw, Send } from "lucide-react";
import { runGenerate, sendForReview } from "./actions";

export function GeneratePanel({
  inspectionId,
  canGenerate,
  disabledReason,
  initialDocWebUrl,
  recipientConfigured,
}: {
  inspectionId: string;
  canGenerate: boolean;
  disabledReason: string | null;
  initialDocWebUrl: string | null;
  recipientConfigured: boolean;
}) {
  const [docWebUrl, setDocWebUrl] = useState<string | null>(initialDocWebUrl);
  const [generating, startGenerate] = useTransition();
  const [sending, startSend] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const downloadHref = `/inspect/${inspectionId}/generate/download`;

  function generate() {
    setError(null);
    startGenerate(async () => {
      try {
        const { docWebUrl } = await runGenerate(inspectionId);
        setDocWebUrl(docWebUrl);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn’t generate the report.");
      }
    });
  }

  function send() {
    setError(null);
    setSentNote(null);
    startSend(async () => {
      try {
        const { webLink } = await sendForReview(inspectionId);
        window.open(webLink, "_blank", "noopener,noreferrer");
        setSentNote("Draft created in Outlook — review and hit Send there.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn’t create the draft.");
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

      {!docWebUrl ? (
        <div>
          <button
            type="button"
            onClick={generate}
            disabled={!canGenerate || generating}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#0072c6] px-5 text-sm font-semibold text-white shadow-sm shadow-[#0072c6]/20 transition-colors hover:bg-[#005ea2] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {generating ? "Generating report…" : "Generate Report"}
          </button>
          {generating && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Generating report — this may take 30 seconds…
            </p>
          )}
          {!canGenerate && disabledReason && !generating && (
            <p className="mt-3 text-sm text-zinc-500">{disabledReason}</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/40">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              Report generated and saved to the inspection’s OneDrive folder.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={downloadHref}
                download
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-zinc-950 dark:text-emerald-300"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download Word document
              </a>
              <button
                type="button"
                onClick={generate}
                disabled={!canGenerate || generating}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-black/[.12] bg-white px-4 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.18] dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-white/[.08]"
              >
                <RefreshCw
                  className={`h-4 w-4 ${generating ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {generating ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
            {generating && (
              <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
                Regenerating — this may take 30 seconds…
              </p>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#0072c6] px-5 text-sm font-semibold text-white shadow-sm shadow-[#0072c6]/20 transition-colors hover:bg-[#005ea2] disabled:opacity-60"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {sending ? "Creating draft…" : "Send to Dave for review"}
            </button>
            {!recipientConfigured && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                <Mail className="h-4 w-4" aria-hidden="true" />
                Set REVIEW_RECIPIENT_EMAIL in .env.local first.
              </p>
            )}
            {sentNote && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                {sentNote}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
