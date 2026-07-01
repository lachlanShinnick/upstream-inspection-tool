"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, ClipboardList, X } from "lucide-react";
import {
  createReportedItem,
  uploadInspectionPhoto,
  type ReportPhoto,
} from "./actions";

type Mode = "default" | "report";

const ACCENT = "#0072c6";

export function CaptureScreen({
  inspectionId,
  propertyName,
  inspectionDate,
  initialAreas,
  initialInReport,
}: {
  inspectionId: string;
  propertyName: string;
  inspectionDate: string;
  initialAreas: string[];
  initialInReport: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [camError, setCamError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("default");
  const [busy, setBusy] = useState(false);

  const [totalTaken, setTotalTaken] = useState(0);
  const [inReportSaved, setInReportSaved] = useState(initialInReport);
  const [reportPhotos, setReportPhotos] = useState<ReportPhoto[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [areas, setAreas] = useState<string[]>(initialAreas);
  const [toast, setToast] = useState<string | null>(null);

  // --- Camera lifecycle ---
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) {
          setCamError(
            "Couldn’t access the camera. Allow camera permission and reload.",
          );
        }
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // --- Toast auto-dismiss ---
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Grab the current video frame, resize to 1920px long edge, encode JPEG. */
  async function frameToJpeg(): Promise<{
    blob: Blob;
    width: number;
    height: number;
  } | null> {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, 1920 / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
    );
    return blob ? { blob, width: w, height: h } : null;
  }

  async function capture() {
    if (busy) return;
    setBusy(true);
    try {
      const shot = await frameToJpeg();
      if (!shot) throw new Error("Camera not ready.");
      const fd = new FormData();
      fd.append("file", shot.blob, "photo.jpg");
      const uploaded = await uploadInspectionPhoto(inspectionId, fd);
      setTotalTaken((n) => n + 1);
      if (mode === "report") {
        setReportPhotos((arr) => [
          ...arr,
          { ...uploaded, width: shot.width, height: shot.height },
        ]);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  function startReport() {
    setReportPhotos([]);
    setMode("report");
  }

  function cancelReport() {
    // Photos stay in OneDrive; we just drop the collected array.
    setReportPhotos([]);
    setShowForm(false);
    setMode("default");
  }

  async function saveItem(area: string, comment: string) {
    const photosForItem = reportPhotos;
    await createReportedItem(inspectionId, area, comment, photosForItem);
    setInReportSaved((n) => n + photosForItem.length);
    const trimmed = area.trim();
    if (trimmed && !areas.includes(trimmed)) setAreas((a) => [...a, trimmed]);
    setReportPhotos([]);
    setShowForm(false);
    setMode("default");
    setToast(
      `Action item saved with ${photosForItem.length} photo${
        photosForItem.length === 1 ? "" : "s"
      }.`,
    );
  }

  const headerMain =
    mode === "report"
      ? `${reportPhotos.length} photo${reportPhotos.length === 1 ? "" : "s"} for this action item`
      : `${totalTaken} photo${totalTaken === 1 ? "" : "s"} taken`;

  return (
    <div className="relative flex h-dvh flex-col bg-black text-white">
      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/80 via-black/45 to-transparent px-4 pb-10 pt-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 rounded-lg bg-black/28 px-3 py-2 backdrop-blur-md">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/72 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Dashboard
            </Link>
            <p className="mt-1 max-w-[58vw] truncate text-sm font-semibold leading-tight text-white">
              {propertyName}
            </p>
            <p className="text-xs text-white/58">{inspectionDate}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="rounded-lg bg-black/28 px-3 py-2 text-right backdrop-blur-md">
              <p className="text-sm font-semibold">{headerMain}</p>
              <p className="text-xs text-white/58">
                {totalTaken} photos · {inReportSaved} in report
              </p>
            </div>
            <Link
              href={`/inspect/${inspectionId}/generate`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-black hover:bg-white"
            >
              Review &amp; generate
            </Link>
          </div>
        </div>
      </header>

      {/* Camera */}
      <div className="relative flex-1 overflow-hidden">
        {camError ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-white/80">
            {camError}
          </div>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        )}
      </div>

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/58 to-transparent px-4 pb-7 pt-14 sm:px-6">
        {mode === "report" && (
          <p className="mx-auto mb-3 w-fit rounded-md bg-white/12 px-3 py-1.5 text-center text-xs font-semibold text-white/82 backdrop-blur">
            Collecting photos for a new action item
          </p>
        )}

        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          {/* Left slot */}
          <div className="w-28">
            {mode === "report" && (
              <button
                type="button"
                onClick={cancelReport}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-white/12 px-3 text-sm font-semibold text-white backdrop-blur hover:bg-white/22"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel
              </button>
            )}
          </div>

          {/* Shutter */}
          <button
            type="button"
            onClick={capture}
            disabled={busy || !!camError}
            aria-label="Take photo"
            className="relative h-20 w-20 rounded-full border-[5px] border-white bg-white/10 shadow-2xl shadow-black/40 disabled:opacity-50"
          >
            <span
              className={`absolute inset-2 grid place-items-center rounded-full bg-white text-[#111817] transition-transform ${
                busy ? "scale-75 animate-pulse" : "scale-100"
              }`}
            >
              <Camera className="h-7 w-7" aria-hidden="true" />
            </span>
          </button>

          {/* Right slot */}
          <div className="flex w-28 justify-end">
            {mode === "default" ? (
              <button
                type="button"
                onClick={startReport}
                style={{ backgroundColor: ACCENT }}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-black/25"
              >
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
                <span className="leading-tight">Report</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-black shadow-lg shadow-black/25"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Done
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Slide-up form */}
      <ItemForm
        key={showForm ? "item-form-open" : "item-form-closed"}
        open={showForm}
        areas={areas}
        photoCount={reportPhotos.length}
        onCancel={() => setShowForm(false)}
        onSave={saveItem}
      />

      {/* Toast */}
      {toast && (
        <div className="absolute inset-x-0 top-24 z-20 flex justify-center px-4">
          <div className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemForm({
  open,
  areas,
  photoCount,
  onCancel,
  onSave,
}: {
  open: boolean;
  areas: string[];
  photoCount: number;
  onCancel: () => void;
  onSave: (area: string, comment: string) => Promise<void>;
}) {
  const [area, setArea] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!area.trim()) {
      setError("Enter an area.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(area, comment);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save.");
      setSaving(false);
    }
  }

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-30 rounded-t-lg bg-white p-5 text-black shadow-2xl transition-transform duration-300 sm:p-6 dark:bg-zinc-900 dark:text-white ${
        open ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
    >
      <div className="mx-auto w-full max-w-xl">
        <h2 className="text-xl font-semibold tracking-normal">New action item</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {photoCount} photo{photoCount === 1 ? "" : "s"} attached
        </p>

        <label className="mt-4 block text-sm font-medium">Area</label>
        <input
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="e.g. Kitchen, Front yard"
          className="mt-1 w-full rounded-lg border border-black/10 bg-[#fbfcfb] px-4 py-3 text-base outline-none transition-colors placeholder:text-zinc-400 focus:border-[#0072c6] focus:bg-white dark:border-white/15 dark:bg-zinc-950"
        />
        {areas.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {areas.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setArea(a)}
                className="rounded-md bg-black/[.06] px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-black/[.1] dark:bg-white/10 dark:text-zinc-200"
              >
                {a}
              </button>
            ))}
          </div>
        )}

        <label className="mt-4 block text-sm font-medium">Comment</label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="Describe the action needed…"
          className="mt-1 w-full rounded-lg border border-black/10 bg-[#fbfcfb] px-4 py-3 text-base outline-none transition-colors placeholder:text-zinc-400 focus:border-[#0072c6] focus:bg-white dark:border-white/15 dark:bg-zinc-950"
        />

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded-lg border border-black/15 px-5 py-3 text-sm font-semibold dark:border-white/20"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            style={{ backgroundColor: ACCENT }}
            className="flex-1 rounded-lg px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-[#0072c6]/20 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
