"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { findOrCreateSubfolder } from "@/lib/graph";
import { parseReportType, REPORT_TYPES, type ReportType } from "@/lib/reportTypes";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Today's date in Adelaide, as both an ISO date and the folder-name format. */
function adelaideToday(reportType: ReportType) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Adelaide",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  return {
    isoDate: `${y}-${m}-${d}`,
    folderName: `${y} ${m} ${d} - ${REPORT_TYPES[reportType].folderSuffix}`,
  };
}

/**
 * Create an inspection for the chosen property folder:
 *   property folder -> FM -> Inspections -> "YYYY MM DD - Council Inspection"
 * then insert the inspection row and go to its working screen.
 */
export async function startInspection(
  propertyFolderId: string,
  propertyName: string,
  requestedReportType: ReportType,
) {
  const session = await auth();
  if (!session?.user?.oid) {
    throw new Error("Not signed in.");
  }
  const reportType = parseReportType(requestedReportType);

  const driveId = process.env.PROPERTIES_DRIVE_ID;
  if (!driveId) {
    throw new Error("PROPERTIES_DRIVE_ID is not set.");
  }

  // Resolve the current user's DB id from their Entra oid.
  const { data: user, error: userErr } = await supabaseAdmin()
    .from("users")
    .select("id")
    .eq("m365_oid", session.user.oid)
    .single();
  if (userErr || !user) {
    throw new Error("Couldn't find your account. Try signing out and back in.");
  }

  // Build the OneDrive folder tree (idempotent find-or-create at each level).
  const fm = await findOrCreateSubfolder(driveId, propertyFolderId, "FM");
  const inspections = await findOrCreateSubfolder(driveId, fm.id, "Inspections");
  const { isoDate, folderName } = adelaideToday(reportType);
  const dated = await findOrCreateSubfolder(driveId, inspections.id, folderName);

  const { data: inspection, error: insertErr } = await supabaseAdmin()
    .from("inspections")
    .insert({
      property_name: propertyName,
      onedrive_drive_id: driveId,
      onedrive_property_folder_id: propertyFolderId,
      onedrive_subfolder_id: dated.id,
      user_id: user.id,
      inspection_date: isoDate,
      report_type: reportType,
      status: "draft",
    })
    .select("id")
    .single();
  if (insertErr || !inspection) {
    throw new Error(
      `Failed to create inspection: ${insertErr?.message ?? "unknown error"}`,
    );
  }

  redirect(`/inspect/${inspection.id}`);
}
