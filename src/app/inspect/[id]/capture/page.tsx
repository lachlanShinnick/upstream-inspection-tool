import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { formatPropertyName } from "@/lib/propertyName";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CaptureScreen } from "../capture-screen";

export default async function IncomingCapturePage({
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
    .select("id, property_name, inspection_date, report_type")
    .eq("id", id)
    .maybeSingle();
  if (!inspection || inspection.report_type !== "incoming") {
    redirect(`/inspect/${id}`);
  }

  const { data: items } = await sb
    .from("action_items")
    .select("id, area")
    .eq("inspection_id", id);
  const areas = [
    ...new Set((items ?? []).map((item) => item.area).filter(Boolean)),
  ];

  return (
    <CaptureScreen
      inspectionId={inspection.id}
      propertyName={formatPropertyName(inspection.property_name)}
      inspectionDate={inspection.inspection_date}
      initialAreas={areas}
      initialInReport={items?.length ?? 0}
      isIncoming
    />
  );
}
