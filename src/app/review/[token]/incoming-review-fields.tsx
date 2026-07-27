"use client";

import { useState } from "react";
import { Plus, Sparkles, Trash2, Undo2 } from "lucide-react";
import {
  type IncomingCommentRow,
  type IncomingInspectionDetails,
  type IncomingServiceRow,
} from "@/lib/incomingInspection";
import { Card } from "@/app/review/ui";
import { regenerateCommentSuggestion } from "./actions";

const inputClass =
  "mt-1 block min-h-10 w-full rounded-lg border border-black/[.12] bg-white px-3 py-2 text-sm text-[#111817] dark:border-white/[.18] dark:bg-zinc-900 dark:text-zinc-50";

export function IncomingReviewFields({
  token,
  details,
  onChange,
}: {
  token: string;
  details: IncomingInspectionDetails;
  onChange: (details: IncomingInspectionDetails) => void;
}) {
  // Text each comment had before a suggestion replaced it, so the reviewer can
  // put it back. Only set once per comment -- repeated suggestions still revert
  // to what the inspector originally wrote.
  const [preSuggestion, setPreSuggestion] = useState<Map<string, string>>(
    new Map(),
  );
  const [suggesting, setSuggesting] = useState<Set<string>>(new Set());
  const [aiError, setAiError] = useState<string | null>(null);

  function patch<K extends keyof IncomingInspectionDetails>(
    key: K,
    value: IncomingInspectionDetails[K],
  ) {
    onChange({ ...details, [key]: value });
  }

  function updateComment(id: string, changes: Partial<IncomingCommentRow>) {
    patch(
      "otherComments",
      details.otherComments.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    );
  }

  function setCommentText(id: string, text: string) {
    updateComment(id, { text });
  }

  function rememberOriginal(id: string, text: string) {
    setPreSuggestion((prev) =>
      prev.has(id) ? prev : new Map(prev).set(id, text),
    );
  }

  async function suggestComment(row: IncomingCommentRow) {
    // Already polished once -- reuse it rather than paying for another call,
    // the same way chooseAi reuses a stored ai_comment.
    if (row.aiText) {
      rememberOriginal(row.id, row.text);
      setCommentText(row.id, row.aiText);
      return;
    }
    if (!row.text.trim()) {
      setAiError("Write the comment first, then ask for a suggestion.");
      return;
    }
    setAiError(null);
    setSuggesting((prev) => new Set(prev).add(row.id));
    try {
      const generated = await regenerateCommentSuggestion(
        token,
        row.id,
        row.text,
      );
      if (generated) {
        rememberOriginal(row.id, row.text);
        updateComment(row.id, { text: generated, aiText: generated });
      } else {
        setAiError("No AI suggestion could be generated for this comment.");
      }
    } catch (e) {
      setAiError(
        e instanceof Error ? e.message : "Couldn't generate a suggestion.",
      );
    } finally {
      setSuggesting((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  }

  function revertComment(id: string) {
    const original = preSuggestion.get(id);
    if (original === undefined) return;
    setCommentText(id, original);
    setPreSuggestion((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  function updateService(
    key: "hvacUnits" | "fireServices",
    id: string,
    field: "type" | "location" | "lastServiceDate",
    value: string,
  ) {
    patch(
      key,
      details[key].map((row) =>
        row.id === id ? { ...row, [field]: value } : row,
      ),
    );
  }

  function addService(key: "hvacUnits" | "fireServices") {
    const row: IncomingServiceRow = {
      id: crypto.randomUUID(),
      type: "",
      ...(key === "hvacUnits" ? { location: "" } : {}),
      lastServiceDate: "",
    };
    patch(key, [...details[key], row] as IncomingServiceRow[]);
  }

  return (
    <>
      <Card>
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          Property and tenant
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Street address"
            value={details.streetAddress}
            onChange={(value) => patch("streetAddress", value)}
          />
          <Field
            label="Suburb"
            value={details.suburb}
            onChange={(value) => patch("suburb", value)}
          />
          <Field
            label="Property type"
            value={details.propertyType}
            onChange={(value) => patch("propertyType", value)}
          />
          <Field
            label="Area"
            value={details.propertyArea}
            onChange={(value) => patch("propertyArea", value)}
          />
          <Field
            label="Tenant company"
            value={details.tenantCompany}
            onChange={(value) => patch("tenantCompany", value)}
          />
          <Field
            label="Contact name"
            value={details.tenantContactName}
            onChange={(value) => patch("tenantContactName", value)}
          />
          <Field
            label="Contact number"
            value={details.tenantContactNumber}
            onChange={(value) => patch("tenantContactNumber", value)}
          />
          <Field
            label="Lease term"
            value={details.leaseTerm}
            onChange={(value) => patch("leaseTerm", value)}
          />
          <Field
            label="Commencement"
            value={details.commencement}
            type="date"
            onChange={(value) => patch("commencement", value)}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          Electrical information
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="NMI"
            value={details.electricalNmi}
            onChange={(value) => patch("electricalNmi", value)}
          />
          <Field
            label="MSB location"
            value={details.electricalMsbLocation}
            onChange={(value) => patch("electricalMsbLocation", value)}
          />
          <Field
            label="Capacity"
            value={details.electricalCapacity}
            onChange={(value) => patch("electricalCapacity", value)}
          />
          <Field
            label="Number of DBs"
            value={details.electricalDbCount}
            onChange={(value) => patch("electricalDbCount", value)}
          />
        </div>
      </Card>

      <ServiceEditor
        title="HVAC"
        rows={details.hvacUnits}
        withLocation
        onAdd={() => addService("hvacUnits")}
        onChange={(id, field, value) =>
          updateService("hvacUnits", id, field, value)
        }
        onRemove={(id) =>
          patch(
            "hvacUnits",
            details.hvacUnits.filter((row) => row.id !== id),
          )
        }
      />

      <ServiceEditor
        title="Fire services"
        rows={details.fireServices}
        onAdd={() => addService("fireServices")}
        onChange={(id, field, value) =>
          updateService("fireServices", id, field, value)
        }
        onRemove={(id) =>
          patch(
            "fireServices",
            details.fireServices.filter((row) => row.id !== id),
          )
        }
      />

      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
            Other comments
          </h2>
          <button
            type="button"
            onClick={() =>
              patch("otherComments", [
                ...details.otherComments,
                { id: crypto.randomUUID(), text: "" },
              ])
            }
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/[.12] px-3 text-sm font-semibold dark:border-white/[.18]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </button>
        </div>
        {aiError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {aiError}
          </p>
        )}
        {details.otherComments.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">None recorded.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {details.otherComments.map((row, index) => {
              const busy = suggesting.has(row.id);
              const reverted = preSuggestion.has(row.id);
              return (
                <li key={row.id} className="flex items-start gap-3">
                  <span className="mt-2.5 w-5 shrink-0 text-sm font-semibold text-zinc-400">
                    {index + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <label>
                      <span className="sr-only">Comment {index + 1}</span>
                      <textarea
                        value={row.text}
                        rows={2}
                        onChange={(event) =>
                          setCommentText(row.id, event.target.value)
                        }
                        className={`${inputClass} mt-0 resize-y`}
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => suggestComment(row)}
                        disabled={busy}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-black/[.12] px-3 text-xs font-semibold text-zinc-600 transition-colors hover:bg-black/[.04] disabled:cursor-default disabled:opacity-50 dark:border-white/[.18] dark:text-zinc-300 dark:hover:bg-white/[.08]"
                      >
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                        {busy ? "Generating…" : "AI suggestion"}
                      </button>
                      {reverted && (
                        <button
                          type="button"
                          onClick={() => revertComment(row.id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-zinc-500 transition-colors hover:bg-black/[.04] hover:text-zinc-700 dark:hover:bg-white/[.08] dark:hover:text-zinc-200"
                        >
                          <Undo2 className="h-3 w-3" aria-hidden="true" />
                          Revert
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      patch(
                        "otherComments",
                        details.otherComments.filter(
                          (item) => item.id !== row.id,
                        ),
                      )
                    }
                    title={`Remove comment ${index + 1}`}
                    aria-label={`Remove comment ${index + 1}`}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function ServiceEditor({
  title,
  rows,
  withLocation = false,
  onAdd,
  onChange,
  onRemove,
}: {
  title: string;
  rows: IncomingServiceRow[];
  withLocation?: boolean;
  onAdd: () => void;
  onChange: (
    id: string,
    field: "type" | "location" | "lastServiceDate",
    value: string,
  ) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {title}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/[.12] px-3 text-sm font-semibold dark:border-white/[.18]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">None recorded.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="grid gap-3 border-b border-black/[.08] pb-4 last:border-0 dark:border-white/[.12] sm:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <Field
                label={`${title} ${index + 1} type`}
                value={row.type}
                onChange={(value) => onChange(row.id, "type", value)}
              />
              {withLocation && (
                <Field
                  label="Outdoor unit location"
                  value={row.location ?? ""}
                  onChange={(value) => onChange(row.id, "location", value)}
                />
              )}
              <Field
                label="Last service date"
                value={row.lastServiceDate}
                type="date"
                onChange={(value) =>
                  onChange(row.id, "lastServiceDate", value)
                }
              />
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                title={`Remove ${title.toLowerCase()} ${index + 1}`}
                aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
                className="grid h-10 w-10 place-items-center self-end rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
}) {
  return (
    <label className="block text-sm font-semibold text-[#111817] dark:text-zinc-50">
      {label}
      {/* No `required` attribute: the review editor saves through an action,
          not a form submit, so it would never fire. The server revalidates
          with validateIncomingDetails. */}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </label>
  );
}
