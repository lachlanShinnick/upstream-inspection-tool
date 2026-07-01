import { redirect } from "next/navigation";
import { ArrowLeft, Camera } from "lucide-react";
import { auth } from "@/auth";
import { getDriveItemWebUrl } from "@/lib/graph";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AppShell, Card, NavLink } from "@/app/ui";
import { GeneratePanel } from "./generate-panel";

function formatDateAU(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${m}/${y}`;
}

export default async function GeneratePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const sb = supabaseAdmin();

  const { data: inspection } = await sb
    .from("inspections")
    .select(
      "id, property_name, inspection_date, status, onedrive_drive_id, generated_doc_onedrive_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (!inspection) {
    return (
      <AppShell
        eyebrow="Generate report"
        title="Inspection not found"
        actions={
          <NavLink href="/dashboard">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </NavLink>
        }
      >
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            It may have been removed or the link may be incorrect.
          </p>
        </Card>
      </AppShell>
    );
  }

  // Counts for the summary.
  const { data: items } = await sb
    .from("action_items")
    .select("id")
    .eq("inspection_id", id);
  const itemCount = items?.length ?? 0;

  let photoCount = 0;
  if (itemCount > 0) {
    const { count } = await sb
      .from("photos")
      .select("id", { count: "exact", head: true })
      .in(
        "action_item_id",
        items!.map((i) => i.id),
      );
    photoCount = count ?? 0;
  }

  const alreadyGenerated = inspection.status === "generated";
  // Generation (and re-generation) is allowed whenever there's at least one item.
  const canGenerate = itemCount > 0;

  const disabledReason =
    itemCount === 0
      ? "Add at least one action item before generating."
      : null;

  // If a doc already exists, resolve its web URL for the download link.
  let initialDocWebUrl: string | null = null;
  if (alreadyGenerated && inspection.generated_doc_onedrive_id) {
    initialDocWebUrl = await getDriveItemWebUrl(
      inspection.onedrive_drive_id,
      inspection.generated_doc_onedrive_id,
    );
  }

  return (
    <AppShell
      eyebrow="Generate report"
      title={inspection.property_name}
      subtitle={`Council routine inspection · ${formatDateAU(inspection.inspection_date)}`}
      actions={
        <>
          <NavLink href={`/inspect/${id}`}>
            <Camera className="h-4 w-4" aria-hidden="true" />
            Capture
          </NavLink>
          <NavLink href="/dashboard">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </NavLink>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
            Summary
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <SummaryRow label="Property" value={inspection.property_name} />
            <SummaryRow
              label="Date"
              value={formatDateAU(inspection.inspection_date)}
            />
            <SummaryRow label="Action items" value={String(itemCount)} />
            <SummaryRow label="Photos" value={String(photoCount)} />
            <SummaryRow label="Status" value={inspection.status} />
          </dl>
        </Card>

        <Card>
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
            Document
          </h2>
          <p className="mt-2 mb-4 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Fills the branded template with action items, photos and your
            sign-off, saves it to OneDrive, then drafts an email to Dave.
          </p>
          <GeneratePanel
            inspectionId={inspection.id}
            canGenerate={canGenerate}
            disabledReason={disabledReason}
            initialDocWebUrl={initialDocWebUrl}
            recipientConfigured={!!process.env.REVIEW_RECIPIENT_EMAIL}
          />
        </Card>
      </div>
    </AppShell>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-right font-semibold text-[#111817] dark:text-zinc-50">
        {value}
      </dd>
    </div>
  );
}
