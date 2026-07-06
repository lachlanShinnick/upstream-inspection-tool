import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { formatPropertyName } from "@/lib/propertyName";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AppShell, Card, NavLink } from "@/app/ui";
import { CaptureScreen } from "./capture-screen";

export default async function InspectionPage({
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
    .select("id, property_name, inspection_date, status, report_type")
    .eq("id", id)
    .maybeSingle();

  if (!inspection) {
    return (
      <AppShell
        eyebrow="Inspection"
        title="Inspection not found"
        subtitle="The requested inspection could not be loaded."
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

  // Areas already used + how many photos are already in the report.
  const { data: items } = await sb
    .from("action_items")
    .select("id, area")
    .eq("inspection_id", id);

  const areas = [
    ...new Set((items ?? []).map((i) => i.area).filter((a): a is string => !!a)),
  ];

  let inReport = 0;
  if (items && items.length > 0) {
    const { count } = await sb
      .from("photos")
      .select("id", { count: "exact", head: true })
      .in(
        "action_item_id",
        items.map((i) => i.id),
      );
    inReport = count ?? 0;
  }

  const isIncident = inspection.report_type === "incident";
  let noteCount = 0;
  if (isIncident) {
    const { count } = await sb
      .from("incident_notes")
      .select("id", { count: "exact", head: true })
      .eq("inspection_id", id);
    noteCount = count ?? 0;
  }

  return (
    <CaptureScreen
      inspectionId={inspection.id}
      propertyName={formatPropertyName(inspection.property_name)}
      inspectionDate={inspection.inspection_date}
      initialAreas={areas}
      initialInReport={inReport}
      isIncident={isIncident}
      initialNoteCount={noteCount}
    />
  );
}
