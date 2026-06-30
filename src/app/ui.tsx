import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

export function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClass =
    size === "lg"
      ? "h-14 w-52"
      : size === "sm"
        ? "h-8 w-32"
        : "h-10 w-40";

  return (
    <Image
      src="/UpstreamProperty.png"
      alt="Upstream Property"
      width={1538}
      height={423}
      priority={size !== "sm"}
      className={`${sizeClass} shrink-0 object-contain object-left`}
    />
  );
}

export function AppShell({
  title,
  subtitle,
  eyebrow,
  children,
  actions,
  align = "start",
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  children: ReactNode;
  actions?: ReactNode;
  align?: "start" | "center";
}) {
  const centered = align === "center";

  return (
    <main className="min-h-dvh bg-[#f6f7f5] px-4 py-5 text-[#18211f] sm:px-6 sm:py-8 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex flex-col gap-5 rounded-lg border border-black/[.08] bg-white/90 p-4 shadow-sm shadow-black/[.03] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-white/[.12] dark:bg-zinc-950/90">
          <Link href="/dashboard" className="flex min-w-0 items-center">
            <BrandMark />
          </Link>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {actions}
            </div>
          )}
        </header>

        <section className={`pt-8 sm:pt-10 ${centered ? "text-center" : ""}`}>
          {eyebrow && (
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0072c6] dark:text-sky-300">
              {eyebrow}
            </p>
          )}
          <div className={`mt-2 max-w-3xl ${centered ? "mx-auto" : ""}`}>
            <h1 className="text-balance text-3xl font-semibold tracking-normal text-[#111817] sm:text-4xl dark:text-zinc-50">
              {title}
            </h1>
            {subtitle && (
              <p
                className={`mt-3 max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-300 ${
                  centered ? "mx-auto" : ""
                }`}
              >
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

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-black/[.08] bg-white p-5 shadow-sm shadow-black/[.03] sm:p-6 dark:border-white/[.12] dark:bg-zinc-950 ${className}`}
    >
      {children}
    </section>
  );
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-black/[.04] hover:text-[#111817] dark:text-zinc-300 dark:hover:bg-white/[.08] dark:hover:text-white"
    >
      {children}
    </Link>
  );
}

export function PrimaryButton({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#0072c6] px-4 text-sm font-semibold text-white shadow-sm shadow-[#0072c6]/20 transition-colors hover:bg-[#005ea2] ${className}`}
    >
      {children}
    </span>
  );
}
