"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  Flame,
  Plus,
  Snowflake,
  Trash2,
  Zap,
} from "lucide-react";
import {
  type IncomingInspectionDetails,
  type IncomingServiceRow,
  validateIncomingDetails,
} from "@/lib/incomingInspection";
import { AppShell, Card } from "@/app/ui";
import {
  deleteIncomingObservation,
  saveIncomingDetails,
} from "./incoming-actions";

export type IncomingObservation = {
  id: string;
  area: string;
  condition: string;
  comment: string;
  photoId: string | null;
};

const inputClass =
  "mt-1 block min-h-11 w-full rounded-lg border border-black/[.12] bg-white px-3 py-2 text-sm text-[#111817] outline-none focus:border-[#0072c6] dark:border-white/[.18] dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "block text-sm font-semibold text-[#111817] dark:text-zinc-50";

function detailsDraftKey(inspectionId: string) {
  return `upstream-incoming-details:${inspectionId}`;
}

function readDetailsDraft(
  inspectionId: string,
  fallback: IncomingInspectionDetails,
): IncomingInspectionDetails {
  if (typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(detailsDraftKey(inspectionId)) ?? "null",
    ) as IncomingInspectionDetails | null;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.hvacUnits) &&
      Array.isArray(parsed.fireServices)
    ) {
      return parsed;
    }
  } catch {
    // Ignore damaged or unavailable local storage and use the server copy.
  }
  return fallback;
}

function requiredSetup(details: IncomingInspectionDetails): boolean {
  return [
    details.streetAddress,
    details.suburb,
    details.propertyType,
    details.propertyArea,
    details.tenantCompany,
    details.tenantContactName,
    details.tenantContactNumber,
    details.leaseTerm,
    details.commencement,
  ].every((value) => value.trim());
}

function requiredElectrical(details: IncomingInspectionDetails): boolean {
  return [
    details.electricalNmi,
    details.electricalMsbLocation,
    details.electricalCapacity,
    details.electricalDbCount,
  ].every((value) => value.trim());
}

function newServiceRow(withLocation: boolean): IncomingServiceRow {
  return {
    id: crypto.randomUUID(),
    type: "",
    ...(withLocation ? { location: "" } : {}),
    lastServiceDate: "",
  };
}

export function IncomingInspectionScreen({
  inspectionId,
  propertyName,
  inspectionDate,
  initialDetails,
  initialObservations,
}: {
  inspectionId: string;
  propertyName: string;
  inspectionDate: string;
  initialDetails: IncomingInspectionDetails;
  initialObservations: IncomingObservation[];
}) {
  const router = useRouter();
  const [restoredDetails] = useState(() =>
    readDetailsDraft(inspectionId, initialDetails),
  );
  const [details, setDetails] = useState(restoredDetails);
  const [setupComplete, setSetupComplete] = useState(() =>
    requiredSetup(restoredDetails),
  );
  const [editingSetup, setEditingSetup] = useState(false);
  const [showElectrical, setShowElectrical] = useState(() =>
    requiredElectrical(restoredDetails),
  );
  const [observations, setObservations] = useState(initialObservations);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const missing = useMemo(() => validateIncomingDetails(details), [details]);
  const ready = missing.length === 0;

  useEffect(() => {
    const snapshot = JSON.stringify(details);
    try {
      window.localStorage.setItem(
        detailsDraftKey(inspectionId),
        snapshot,
      );
    } catch {
      // The server copy still saves through explicit navigation and controls.
    }

    const timer = window.setTimeout(() => {
      void saveIncomingDetails(inspectionId, details)
        .then(() => {
          if (
            window.localStorage.getItem(detailsDraftKey(inspectionId)) ===
            snapshot
          ) {
            window.localStorage.removeItem(detailsDraftKey(inspectionId));
          }
        })
        .catch(() => {
          // Keep the local draft when offline; it will be restored on return.
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [details, inspectionId]);

  function patch<K extends keyof IncomingInspectionDetails>(
    key: K,
    value: IncomingInspectionDetails[K],
  ) {
    setDetails((current) => ({ ...current, [key]: value }));
    setSavedNote(null);
  }

  function save(nextDetails = details, afterSave?: () => void) {
    setError(null);
    setSavedNote(null);
    startSaving(async () => {
      try {
        await saveIncomingDetails(inspectionId, nextDetails);
        try {
          window.localStorage.removeItem(detailsDraftKey(inspectionId));
        } catch {
          // The server copy is authoritative once this save succeeds.
        }
        setDetails(nextDetails);
        setSavedNote("Information saved.");
        afterSave?.();
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "Couldn't save information.",
        );
      }
    });
  }

  function saveInitialSetup() {
    if (!requiredSetup(details)) {
      setError("Complete every property and tenant field before continuing.");
      return;
    }
    save(details, () => {
      setSetupComplete(true);
      setEditingSetup(false);
    });
  }

  function saveAndNavigate(href: string) {
    save(details, () => router.push(href));
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
    patch(key, [
      ...details[key],
      newServiceRow(key === "hvacUnits"),
    ] as IncomingServiceRow[]);
  }

  function removeService(key: "hvacUnits" | "fireServices", id: string) {
    patch(
      key,
      details[key].filter((row) => row.id !== id),
    );
  }

  function removeObservation(itemId: string) {
    setError(null);
    startSaving(async () => {
      try {
        await deleteIncomingObservation(inspectionId, itemId);
        setObservations((current) =>
          current.filter((item) => item.id !== itemId),
        );
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "Couldn't remove the photo.",
        );
      }
    });
  }

  if (!setupComplete || editingSetup) {
    return (
      <AppShell
        eyebrow="Incoming inspection setup"
        title={propertyName}
        subtitle="Complete the property and tenant information before starting the inspection."
        actions={
          <button
            type="button"
            onClick={() => saveAndNavigate("/dashboard")}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-black/[.04] hover:text-[#111817] disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-white/[.08] dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </button>
        }
      >
        <Card>
          <div className="grid gap-7 lg:grid-cols-2">
            <SetupFields details={details} patch={patch} />
          </div>
          <Feedback error={error} savedNote={savedNote} />
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            {setupComplete && (
              <button
                type="button"
                onClick={() => setEditingSetup(false)}
                className="min-h-11 rounded-lg border border-black/[.12] px-4 text-sm font-semibold dark:border-white/[.18]"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={saveInitialSetup}
              disabled={saving}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#0072c6] px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {saving ? "Saving..." : "Save and continue"}
            </button>
          </div>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="Incoming inspection"
      title={propertyName}
      subtitle={`Inspection date ${inspectionDate}`}
      actions={
        <>
          <button
            type="button"
            onClick={() => saveAndNavigate("/dashboard")}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-black/[.04] hover:text-[#111817] disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-white/[.08] dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </button>
          {ready ? (
            <button
              type="button"
              onClick={() =>
                saveAndNavigate(`/inspect/${inspectionId}/generate`)
              }
              disabled={saving}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-black/[.04] hover:text-[#111817] disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-white/[.08] dark:hover:text-white"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Review &amp; generate
            </button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {!ready && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
            Complete the required information before generating. Missing:{" "}
            {missing.join(", ")}.
          </div>
        )}
        <Feedback error={error} savedNote={savedNote} />

        <Card>
          <SectionHeading
            title="Property and tenant"
            complete
            action={
              <button
                type="button"
                onClick={() => setEditingSetup(true)}
                className="text-sm font-semibold text-[#0072c6] hover:underline"
              >
                Edit
              </button>
            }
          />
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Summary label="Street address" value={details.streetAddress} />
            <Summary label="Suburb" value={details.suburb} />
            <Summary label="Property type" value={details.propertyType} />
            <Summary label="Area" value={details.propertyArea} />
            <Summary label="Tenant" value={details.tenantCompany} />
            <Summary
              label="Contact"
              value={`${details.tenantContactName} · ${details.tenantContactNumber}`}
            />
            <Summary label="Lease term" value={details.leaseTerm} />
            <Summary label="Commencement" value={details.commencement} />
          </dl>
        </Card>

        <Card>
          <SectionHeading
            title="Electrical information"
            complete={requiredElectrical(details)}
            icon={<Zap className="h-5 w-5" aria-hidden="true" />}
          />
          {!showElectrical ? (
            <button
              type="button"
              onClick={() => setShowElectrical(true)}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#0072c6] px-4 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add electrical information
            </button>
          ) : (
            <>
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
              <SaveSectionButton saving={saving} onClick={() => save()} />
            </>
          )}
        </Card>

        <ServiceSection
          title="HVAC"
          icon={<Snowflake className="h-5 w-5" aria-hidden="true" />}
          rows={details.hvacUnits}
          withLocation
          addLabel="Add HVAC"
          saving={saving}
          onAdd={() => addService("hvacUnits")}
          onChange={(id, field, value) =>
            updateService("hvacUnits", id, field, value)
          }
          onRemove={(id) => removeService("hvacUnits", id)}
          onSave={() => save()}
        />

        <ServiceSection
          title="Fire services"
          icon={<Flame className="h-5 w-5" aria-hidden="true" />}
          rows={details.fireServices}
          addLabel="Add fire service"
          saving={saving}
          onAdd={() => addService("fireServices")}
          onChange={(id, field, value) =>
            updateService("fireServices", id, field, value)
          }
          onRemove={(id) => removeService("fireServices", id)}
          onSave={() => save()}
        />

        <Card>
          <SectionHeading
            title="Condition photos"
            complete
            icon={<Camera className="h-5 w-5" aria-hidden="true" />}
          />
          <div className="mt-4">
            <button
              type="button"
              onClick={() =>
                saveAndNavigate(`/inspect/${inspectionId}/capture`)
              }
              disabled={saving}
              className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-[#0072c6] px-5 text-sm font-semibold text-white"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              {saving ? "Saving..." : "Take inspection photo"}
            </button>
          </div>
          {observations.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
              No condition photos added. Photos are optional for this report.
            </p>
          ) : (
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {observations.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 gap-3 rounded-lg border border-black/[.08] p-3 dark:border-white/[.12]"
                >
                  {item.photoId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/inspect/${inspectionId}/photo/${item.photoId}`}
                      alt=""
                      className="h-20 w-20 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="grid h-20 w-20 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-400 dark:bg-zinc-900">
                      <Camera className="h-5 w-5" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.area}</p>
                    <p className="mt-1 text-xs font-bold uppercase text-[#0072c6]">
                      {item.condition}
                    </p>
                    {item.comment && (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                        {item.comment}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeObservation(item.id)}
                    disabled={saving}
                    title="Remove photo"
                    aria-label={`Remove ${item.area} photo`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {!ready && (
          <Card>
            <p className="text-sm font-semibold text-[#111817] dark:text-white">
              Review &amp; generate is not available yet.
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Fill out the highlighted required information above, then save it.
            </p>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function SetupFields({
  details,
  patch,
}: {
  details: IncomingInspectionDetails;
  patch: <K extends keyof IncomingInspectionDetails>(
    key: K,
    value: IncomingInspectionDetails[K],
  ) => void;
}) {
  return (
    <>
      <section>
        <h2 className="text-base font-semibold">Property information</h2>
        <div className="mt-4 space-y-4">
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
            placeholder="e.g. 450 m²"
            onChange={(value) => patch("propertyArea", value)}
          />
        </div>
      </section>
      <section>
        <h2 className="text-base font-semibold">Tenant information</h2>
        <div className="mt-4 space-y-4">
          <Field
            label="Company"
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
            inputMode="tel"
            onChange={(value) => patch("tenantContactNumber", value)}
          />
          <Field
            label="Lease term"
            value={details.leaseTerm}
            placeholder="Free text"
            onChange={(value) => patch("leaseTerm", value)}
          />
          <Field
            label="Commencement"
            value={details.commencement}
            type="date"
            onChange={(value) => patch("commencement", value)}
          />
        </div>
      </section>
    </>
  );
}

function ServiceSection({
  title,
  icon,
  rows,
  withLocation = false,
  addLabel,
  saving,
  onAdd,
  onChange,
  onRemove,
  onSave,
}: {
  title: string;
  icon: React.ReactNode;
  rows: IncomingServiceRow[];
  withLocation?: boolean;
  addLabel: string;
  saving: boolean;
  onAdd: () => void;
  onChange: (
    id: string,
    field: "type" | "location" | "lastServiceDate",
    value: string,
  ) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <SectionHeading title={title} complete icon={icon} />
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          None added.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="grid gap-3 border-b border-black/[.08] pb-4 last:border-b-0 dark:border-white/[.12] sm:grid-cols-[1fr_1fr_1fr_auto]"
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
                className="grid h-11 w-11 place-items-center self-end rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/[.12] px-4 text-sm font-semibold dark:border-white/[.18]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {addLabel}
        </button>
        {rows.length > 0 && (
          <SaveSectionButton saving={saving} onClick={onSave} compact />
        )}
      </div>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
  placeholder?: string;
  inputMode?: "tel";
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        type={type}
        value={value}
        required
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </label>
  );
}

function SectionHeading({
  title,
  complete,
  icon,
  action,
}: {
  title: string;
  complete: boolean;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center gap-1 text-xs font-bold uppercase ${
            complete ? "text-emerald-700" : "text-amber-700"
          }`}
        >
          {complete ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {complete ? "Complete" : "Required"}
        </span>
        {action}
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-zinc-500">{label}</dt>
      <dd className="mt-1 font-medium text-[#111817] dark:text-white">{value}</dd>
    </div>
  );
}

function SaveSectionButton({
  saving,
  onClick,
  compact = false,
}: {
  saving: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className={`inline-flex items-center gap-2 rounded-lg bg-[#0072c6] px-4 text-sm font-semibold text-white disabled:opacity-60 ${
        compact ? "min-h-11" : "mt-5 min-h-11"
      }`}
    >
      <Check className="h-4 w-4" aria-hidden="true" />
      {saving ? "Saving..." : "Save information"}
    </button>
  );
}

function Feedback({
  error,
  savedNote,
}: {
  error: string | null;
  savedNote: string | null;
}) {
  if (!error && !savedNote) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
        error
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
          : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
      }`}
    >
      {error ?? savedNote}
    </p>
  );
}
