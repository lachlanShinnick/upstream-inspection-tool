import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ClipboardList,
  Download,
  FileSignature,
  FileText,
  LogOut,
  UserRound,
} from "lucide-react";
import { auth, signOut } from "@/auth";
import { getDriveItemWebUrl } from "@/lib/graph";
import { formatPropertyName } from "@/lib/propertyName";
import { REPORT_TYPES, reportTypeInfo, type ReportType } from "@/lib/reportTypes";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AppShell, Card, NavLink, PrimaryButton } from "@/app/ui";

function formatDateAU(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${m}/${y}`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // Read the row back from Supabase keyed on m365_oid. If this returns the
  // user, the sign-in upsert worked end to end.
  let storedUser: {
    id: string;
    name: string | null;
    email: string | null;
    m365_oid: string;
  } | null = null;

  if (session.user?.oid) {
    const { data } = await supabaseAdmin()
      .from("users")
      .select("id, name, email, m365_oid")
      .eq("m365_oid", session.user.oid)
      .maybeSingle();
    storedUser = data;
  }

  const displayName = storedUser?.name ?? session.user?.name ?? "there";

  // Generated reports for this inspector, with their OneDrive links.
  type ReportRow = {
    id: string;
    property_name: string;
    inspection_date: string;
    report_type: string | null;
    webUrl: string | null;
  };
  let reports: ReportRow[] = [];
  if (storedUser?.id) {
    const { data: generated } = await supabaseAdmin()
      .from("inspections")
      .select(
        "id, property_name, inspection_date, report_type, onedrive_drive_id, generated_doc_onedrive_id",
      )
      .eq("user_id", storedUser.id)
      .eq("status", "generated")
      .order("created_at", { ascending: false })
      .limit(10);

    reports = await Promise.all(
      (generated ?? []).map(async (r) => ({
        id: r.id,
        property_name: r.property_name,
        inspection_date: r.inspection_date,
        report_type: r.report_type,
        webUrl: r.generated_doc_onedrive_id
          ? await getDriveItemWebUrl(
              r.onedrive_drive_id,
              r.generated_doc_onedrive_id,
            )
          : null,
      })),
    );
  }

  return (
    <AppShell
      eyebrow="Dashboard"
      title={`Welcome, ${displayName}`}
      subtitle="Start an inspection report, keep your profile details current, and generate consistent reports from the field."
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
          <div className="border-b border-black/[.06] bg-[#eef7fc] px-5 py-5 text-[#111817] sm:px-6 dark:border-white/[.12] dark:bg-zinc-900 dark:text-zinc-50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0072c6] dark:text-sky-300">
                  Field workflow
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-normal">
                  Inspection Reports
                </h2>
              </div>
              <ClipboardList className="h-8 w-8 text-[#0072c6]" aria-hidden="true" />
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              Pick a property, create the dated OneDrive folder, capture report
              items, then generate the branded document for review.
            </p>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
            {(Object.keys(REPORT_TYPES) as ReportType[]).map((type) => {
              const report = REPORT_TYPES[type];
              return (
                <Link key={type} href={`/inspect/new?type=${type}`}>
                  <PrimaryButton className="w-full">
                    + {report.newLabel}
                  </PrimaryButton>
                </Link>
              );
            })}
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#eef7fc] text-[#0072c6] dark:bg-sky-400/10 dark:text-sky-300">
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

      <section className="mt-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#eef7fc] text-[#0072c6] dark:bg-sky-400/10 dark:text-sky-300">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-[#111817] dark:text-zinc-50">
              Generated reports
            </h2>
          </div>

          {reports.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
              No reports generated yet. Finish an inspection and generate its
              report to see it here.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-black/[.06] dark:divide-white/[.08]">
              {reports.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#111817] dark:text-zinc-50">
                      {formatPropertyName(r.property_name)}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {reportTypeInfo(r.report_type).title} ·{" "}
                      {formatDateAU(r.inspection_date)}
                    </p>
                  </div>
                  {r.webUrl ? (
                    <a
                      href={r.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-black/[.12] px-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.18] dark:text-zinc-300 dark:hover:bg-white/[.08]"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Open
                    </a>
                  ) : (
                    <Link
                      href={`/inspect/${r.id}/generate`}
                      className="shrink-0 text-sm font-semibold text-[#0072c6] hover:underline"
                    >
                      View
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </AppShell>
  );
}
