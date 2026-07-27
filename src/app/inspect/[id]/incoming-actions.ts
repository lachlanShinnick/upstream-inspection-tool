"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  incomingDetailsToRow,
  type IncomingInspectionDetails,
} from "@/lib/incomingInspection";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function requireIncomingInspection(inspectionId: string) {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const { data: inspection, error } = await supabaseAdmin()
    .from("inspections")
    .select("id, report_type")
    .eq("id", inspectionId)
    .single();
  if (error || !inspection || inspection.report_type !== "incoming") {
    throw new Error("Incoming inspection not found.");
  }
}

export async function saveIncomingDetails(
  inspectionId: string,
  details: IncomingInspectionDetails,
): Promise<{ saved: true }> {
  await requireIncomingInspection(inspectionId);

  const { error } = await supabaseAdmin()
    .from("incoming_inspection_details")
    .upsert(
      {
        inspection_id: inspectionId,
        ...incomingDetailsToRow(details),
      },
      { onConflict: "inspection_id" },
    );
  if (error) {
    throw new Error(`Couldn't save inspection information: ${error.message}`);
  }

  revalidatePath(`/inspect/${inspectionId}`);
  revalidatePath(`/inspect/${inspectionId}/generate`);
  return { saved: true };
}

export async function deleteIncomingObservation(
  inspectionId: string,
  itemId: string,
): Promise<{ deleted: true }> {
  await requireIncomingInspection(inspectionId);

  const { error } = await supabaseAdmin()
    .from("action_items")
    .delete()
    .eq("id", itemId)
    .eq("inspection_id", inspectionId);
  if (error) throw new Error(`Couldn't remove the photo: ${error.message}`);

  revalidatePath(`/inspect/${inspectionId}`);
  revalidatePath(`/inspect/${inspectionId}/generate`);
  return { deleted: true };
}
