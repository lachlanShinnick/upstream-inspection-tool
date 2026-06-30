import Link from "next/link";
import { WifiOff } from "lucide-react";
import { BrandMark } from "@/app/ui";

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#f6f7f5] px-4 py-16 text-center dark:bg-black">
      <div className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-6 shadow-xl shadow-black/[.06] dark:border-white/[.12] dark:bg-zinc-950">
        <div className="flex justify-center">
          <BrandMark size="lg" />
        </div>
        <div className="mx-auto mt-6 grid h-12 w-12 place-items-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
          <WifiOff className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-normal text-[#111817] dark:text-zinc-50">
          Offline
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The app is installed, but this page needs a connection before it can
          load fresh inspection data.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-[#0072c6] px-5 text-sm font-semibold text-white shadow-sm shadow-[#0072c6]/20 transition-colors hover:bg-[#005ea2]"
        >
          Try dashboard
        </Link>
      </div>
    </main>
  );
}
