"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowRight, Building2, Search } from "lucide-react";
import type { GraphFolder } from "@/lib/graph";
import { startInspection } from "./actions";

export function PropertyPicker({ properties }: { properties: GraphFolder[] }) {
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter((p) => p.name.toLowerCase().includes(q));
  }, [properties, query]);

  function choose(p: GraphFolder) {
    setError(null);
    setPendingId(p.id);
    startTransition(async () => {
      try {
        // Resolves into a redirect on success; surfaces a message on failure.
        await startInspection(p.id, p.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setPendingId(null);
      }
    });
  }

  return (
    <div className="max-w-3xl">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search properties"
          className="h-12 w-full rounded-lg border border-black/[.10] bg-white pl-11 pr-4 text-base text-[#111817] outline-none shadow-sm shadow-black/[.02] transition-colors placeholder:text-zinc-400 focus:border-[#0072c6] dark:border-white/[.14] dark:bg-zinc-950 dark:text-zinc-50"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <ul className="mt-4 divide-y divide-black/[.06] overflow-hidden rounded-lg border border-black/[.08] bg-white shadow-sm shadow-black/[.03] dark:divide-white/[.08] dark:border-white/[.12] dark:bg-zinc-950">
        {filtered.map((p) => {
          const busy = isPending && pendingId === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => choose(p)}
                disabled={isPending}
                className="group flex w-full items-center justify-between gap-4 bg-white px-4 py-4 text-left transition-colors hover:bg-[#f6f7f5] disabled:opacity-50 dark:bg-zinc-950 dark:hover:bg-white/[.05]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#eef5f9] text-[#0072c6] dark:bg-sky-400/10 dark:text-sky-300">
                    <Building2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-[#111817] dark:text-zinc-50">
                      {p.name}
                    </span>
                    <span className="mt-0.5 block text-sm text-zinc-500 dark:text-zinc-400">
                      SharePoint property folder
                    </span>
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-[#0072c6]">
                  {busy ? "Creating..." : "Start"}
                  {!busy && (
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="bg-white px-4 py-10 text-center text-sm text-zinc-500 dark:bg-zinc-950">
            No properties match “{query}”.
          </li>
        )}
      </ul>
    </div>
  );
}
