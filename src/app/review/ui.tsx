import type { ReactNode } from "react";
import { BrandMark } from "@/app/ui";

export { Card } from "@/app/ui";

/**
 * Shell for the unauthenticated /review/[token] pages. Same visual language
 * as AppShell, but the header isn't a link to /dashboard — a reviewer here
 * has no access to the authenticated app.
 */
export function ReviewShell({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-[#f6f7f5] px-4 py-5 text-[#18211f] sm:px-6 sm:py-8 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex flex-col gap-5 rounded-lg border border-black/[.08] bg-white/90 p-4 shadow-sm shadow-black/[.03] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-white/[.12] dark:bg-zinc-950/90">
          <div className="flex min-w-0 items-center">
            <BrandMark />
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {actions}
            </div>
          )}
        </header>

        <section className="pt-8 sm:pt-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0072c6] dark:text-sky-300">
            Inspection review
          </p>
          <div className="mt-2 max-w-3xl">
            <h1 className="text-balance text-3xl font-semibold tracking-normal text-[#111817] sm:text-4xl dark:text-zinc-50">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-300">
                {subtitle}
              </p>
            )}
          </div>
        </section>

        <div className="pt-7 sm:pt-8">{children}</div>
      </div>
    </main>
  );
}
