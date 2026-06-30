import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Camera, CheckCircle2, FileText } from "lucide-react";
import { auth, signIn } from "@/auth";
import { BrandMark } from "@/app/ui";

export default async function LoginPage({
  searchParams,
}: {
  // In Next.js 16, searchParams is async.
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/dashboard");

  const { error } = await searchParams;

  // signIn callback returned false (wrong tenant) -> AccessDenied.
  const message =
    error === "AccessDenied"
      ? "You must be signed in with an Upstream Property account."
      : error
        ? "Something went wrong signing in. Please try again."
        : null;

  return (
    <main className="min-h-dvh bg-[#f6f7f5] px-4 py-6 text-[#18211f] sm:px-6 lg:grid lg:place-items-center dark:bg-black dark:text-zinc-50">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-lg border border-black/[.08] bg-white shadow-xl shadow-black/[.06] lg:grid-cols-[0.95fr_1.05fr] dark:border-white/[.12] dark:bg-zinc-950">
        <section className="p-6 sm:p-8 lg:p-10">
          <div className="flex items-center gap-3">
            <BrandMark size="lg" />
            <div className="sr-only">
              <p className="text-sm font-semibold text-[#111817] dark:text-zinc-50">
                Upstream Property
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Inspection reporting
              </p>
            </div>
          </div>

          <div className="mt-12">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0072c6] dark:text-sky-300">
              Staff login
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-[#111817] dark:text-zinc-50">
              Sign in to continue
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Create council routine inspections, capture action items, and
              prepare branded reports from one focused workspace.
            </p>
          </div>

          {message && (
            <p
              role="alert"
              className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
            >
              {message}
            </p>
          )}

          <form
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
            }}
            className="mt-8"
          >
            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center gap-3 rounded-lg bg-[#0072c6] px-5 text-base font-semibold text-white shadow-sm shadow-[#0072c6]/20 transition-colors hover:bg-[#005ea2]"
            >
              <MicrosoftLogo />
              Sign in with Microsoft 365
            </button>
          </form>
        </section>

        <section className="hidden border-l border-black/[.08] bg-[#eef7fc] p-8 text-[#18211f] lg:block dark:border-white/[.12] dark:bg-zinc-900 dark:text-zinc-50">
          <div className="flex h-full flex-col justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0072c6] dark:text-sky-300">
                Mobile-first field capture
              </p>
              <div className="mt-6 rounded-lg border border-black/[.08] bg-white p-5 shadow-lg shadow-[#0072c6]/10 dark:border-white/[.12] dark:bg-zinc-950">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[#111817] dark:text-zinc-50">
                      14 Brougham Street
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Council inspection
                    </p>
                  </div>
                  <span className="rounded-md bg-[#e6f3fb] px-2.5 py-1 text-xs font-semibold text-[#005ea2] dark:bg-sky-400/10 dark:text-sky-300">
                    Draft
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <PreviewMetric icon={<Camera />} label="Photos" value="18" />
                  <PreviewMetric icon={<CheckCircle2 />} label="Items" value="7" />
                  <PreviewMetric icon={<FileText />} label="Report" value="Ready" />
                </div>
                <div className="mt-5 space-y-2">
                  {["Front entry", "Kitchen", "Boundary fence"].map((area) => (
                    <div
                      key={area}
                      className="flex items-center justify-between rounded-md bg-[#f6f7f5] px-3 py-2 dark:bg-white/[.06]"
                    >
                      <span className="text-sm text-zinc-700 dark:text-zinc-200">
                        {area}
                      </span>
                      <span className="h-2 w-2 rounded-full bg-[#0072c6]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-8 max-w-sm text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Built for fast site walks, clear internal review, and consistent
              council-facing documents.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function PreviewMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md bg-[#eef7fc] p-3 dark:bg-white/[.06]">
      <div className="text-[#0072c6] [&>svg]:h-4 [&>svg]:w-4">{icon}</div>
      <p className="mt-3 text-lg font-semibold text-[#111817] dark:text-zinc-50">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 21 21"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
