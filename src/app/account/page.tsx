import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, Mail, UserRound } from "lucide-react";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AppShell, Card, NavLink } from "@/app/ui";
import { AccountForm } from "./account-form";

type AccountUser = {
  name: string | null;
  email: string | null;
  position: string | null;
  signature_path: string | null;
};

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.oid) redirect("/login");

  const { data: user } = await supabaseAdmin()
    .from("users")
    .select("name, email, position, signature_path")
    .eq("m365_oid", session.user.oid)
    .maybeSingle<AccountUser>();

  return (
    <AppShell
      eyebrow="Account"
      title="Profile and signature"
      subtitle="These details are read from your staff account and reused when inspection reports are generated."
      actions={
        <NavLink href="/dashboard">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </NavLink>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            Signed in as
          </h2>
          {user ? (
            <dl className="mt-5 space-y-4">
              <Row icon={<UserRound />} label="Name" value={user.name} />
              <Row icon={<Mail />} label="Email" value={user.email} />
            </dl>
          ) : (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
              No Supabase row found for this account.
            </p>
          )}
        </Card>

        <AccountForm
          position={user?.position ?? null}
          signaturePath={user?.signature_path ?? null}
        />
      </div>
    </AppShell>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eef5f9] text-[#0072c6] dark:bg-sky-400/10 dark:text-sky-300">
        <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      </div>
      <div className="min-w-0">
        <dt className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {label}
        </dt>
        <dd className="mt-1 break-words text-sm font-semibold text-[#111817] dark:text-zinc-100">
          {value ?? "-"}
        </dd>
      </div>
    </div>
  );
}
