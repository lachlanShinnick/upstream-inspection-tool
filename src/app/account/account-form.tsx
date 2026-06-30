"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import SignatureCanvas from "react-signature-canvas";
import {
  saveSignature,
  updatePosition,
  type AccountActionState,
} from "./actions";

const initialPositionState: AccountActionState = {
  ok: false,
  message: "",
};

export function AccountForm({
  position,
  signaturePath,
}: {
  position: string | null;
  signaturePath: string | null;
}) {
  const signatureRef = useRef<SignatureCanvas | null>(null);
  const [positionState, positionAction, positionPending] = useActionState(
    updatePosition,
    initialPositionState,
  );
  const [signatureSrc, setSignatureSrc] = useState(signaturePath);
  const [signatureMessage, setSignatureMessage] = useState("");
  const [signatureOk, setSignatureOk] = useState(false);
  const [isSavingSignature, startSignatureSave] = useTransition();

  function clearSignature() {
    signatureRef.current?.clear();
    setSignatureMessage("");
  }

  function handleSaveSignature() {
    const pad = signatureRef.current;
    if (!pad || pad.isEmpty()) {
      setSignatureOk(false);
      setSignatureMessage("Add a signature before saving.");
      return;
    }

    startSignatureSave(async () => {
      const canvas = pad.getTrimmedCanvas();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );

      if (!blob) {
        setSignatureOk(false);
        setSignatureMessage("Could not export signature.");
        return;
      }

      const formData = new FormData();
      formData.append("signature", blob, "signature.png");
      const result = await saveSignature(formData);

      setSignatureOk(result.ok);
      setSignatureMessage(result.message);
      if (result.signatureUrl) {
        setSignatureSrc(`${result.signatureUrl}?v=${Date.now()}`);
      }
    });
  }

  return (
    <div className="space-y-5">
      <form
        action={positionAction}
        className="rounded-lg border border-black/[.08] bg-white p-5 shadow-sm shadow-black/[.03] sm:p-6 dark:border-white/[.12] dark:bg-zinc-950"
      >
        <label
          htmlFor="position"
          className="block text-sm font-semibold text-[#111817] dark:text-zinc-100"
        >
          Position
        </label>
        <input
          id="position"
          name="position"
          type="text"
          defaultValue={position ?? ""}
          placeholder="Property Manager"
          className="mt-2 w-full rounded-lg border border-black/10 bg-[#fbfcfb] px-4 py-3 text-base text-[#111817] outline-none transition-colors placeholder:text-zinc-400 focus:border-[#0072c6] focus:bg-white dark:border-white/15 dark:bg-black dark:text-zinc-50"
        />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={positionPending}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0072c6] px-5 text-sm font-semibold text-white shadow-sm shadow-[#0072c6]/20 transition-colors hover:bg-[#005ea2] disabled:opacity-60"
          >
            {positionPending ? "Saving..." : "Save position"}
          </button>
          {positionState.message && (
            <p
              role="status"
              className={`text-sm ${
                positionState.ok
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {positionState.message}
            </p>
          )}
        </div>
      </form>

      <section className="rounded-lg border border-black/[.08] bg-white p-5 shadow-sm shadow-black/[.03] sm:p-6 dark:border-white/[.12] dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-[#111817] dark:text-zinc-100">
          Signature
        </h2>

        {signatureSrc && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Current signature
            </p>
            <div className="mt-2 rounded-lg border border-black/[.08] bg-[#f6f7f5] p-4 dark:border-white/[.12] dark:bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URLs are user-generated and not configured as Next image remotes. */}
              <img
                src={signatureSrc}
                alt="Saved signature"
                className="max-h-32 max-w-full object-contain"
              />
            </div>
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-lg border border-black/10 bg-white shadow-inner dark:border-white/15">
          <SignatureCanvas
            ref={signatureRef}
            penColor="black"
            minWidth={0.8}
            maxWidth={2.4}
            canvasProps={{
              width: 720,
              height: 220,
              className: "block h-56 w-full touch-none bg-white",
              "aria-label": "Signature pad",
            }}
          />
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="button"
            onClick={clearSignature}
            disabled={isSavingSignature}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-black/[.12] px-5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.18] dark:text-zinc-300 dark:hover:bg-white/[.06]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleSaveSignature}
            disabled={isSavingSignature}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0072c6] px-5 text-sm font-semibold text-white shadow-sm shadow-[#0072c6]/20 transition-colors hover:bg-[#005ea2] disabled:opacity-60"
          >
            {isSavingSignature ? "Saving..." : "Save signature"}
          </button>
          {signatureMessage && (
            <p
              role="status"
              className={`text-sm ${
                signatureOk
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {signatureMessage}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
