import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, FileSignature, LogOut, Plus, UserRound } from "lucide-react";
import { auth, signOut } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AppShell, Card, NavLink, PrimaryButton } from "@/app/ui";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // Read the row back from Supabase keyed on m365_oid. If this returns the
  // user, the sign-in upsert worked end to end.
  let storedUser: {
    name: string | null;
    email: string | null;
    m365_oid: string;
  } | null = null;

  if (session.user?.oid) {
    const { data } = await supabaseAdmin()
      .from("users")
      .select("name, email, m365_oid")
      .eq("m365_oid", session.user.oid)
      .maybeSingle();
    storedUser = data;
  }

  const displayName = storedUser?.name ?? session.user?.name ?? "there";

  return (
    <AppShell
      eyebrow="Dashboard"
      title={`Welcome, ${displayName}`}
      subtitle="Start a council routine inspection, keep your profile details current, and generate consistent reports from the field."
      actions={
        <>
          <NavLink href="/account">
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Account
          </NavLink>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-black/[.12] bg-white px-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.18] dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-white/[.08]"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-black/[.06] bg-[#111817] px-5 py-5 text-white sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                  Field workflow
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-normal">
                  Council Routine Inspection
                </h2>
              </div>
              <ClipboardList className="h-8 w-8 text-white/70" aria-hidden="true" />
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/72">
              Pick a property, create the dated OneDrive folder, capture report
              items, then generate the branded document for review.
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <Link href="/inspect/new">
              <PrimaryButton className="w-full sm:w-auto">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New inspection
              </PrimaryButton>
            </Link>
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e8f5ef] text-[#1f7a5a] dark:bg-emerald-400/10 dark:text-emerald-300">
              <FileSignature className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#111817] dark:text-zinc-50">
                Report signature
              </h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Your position and signature are reused when reports are generated.
              </p>
              <Link
                href="/account"
                className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-black/[.12] px-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.18] dark:text-zinc-300 dark:hover:bg-white/[.08]"
              >
                Review account
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
