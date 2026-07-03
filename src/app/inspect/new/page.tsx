import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { listSubfolders, type GraphFolder } from "@/lib/graph";
import { AppShell, NavLink } from "@/app/ui";
import { PropertyPicker } from "./property-picker";

export default async function NewInspectionPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const driveId = process.env.PROPERTIES_DRIVE_ID;
  const folderId = process.env.PROPERTIES_FOLDER_ID;

  let properties: GraphFolder[] = [];
  let loadError: string | null = null;

  if (!driveId || !folderId) {
    loadError =
      "PROPERTIES_DRIVE_ID / PROPERTIES_FOLDER_ID are not set in the app's environment configuration.";
  } else {
    try {
      properties = await listSubfolders(driveId, folderId);
      properties.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      loadError =
        e instanceof Error ? e.message : "Failed to load properties from SharePoint.";
    }
  }

  return (
    <AppShell
      align="center"
      eyebrow="New inspection"
      title="Select a property"
      subtitle="Choose the property folder for this council routine inspection. The app will create the dated OneDrive inspection folder automatically."
      actions={
        <NavLink href="/dashboard">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </NavLink>
      }
    >
      <div className="mx-auto w-full max-w-3xl text-left">
        {loadError ? (
          <p
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {loadError}
          </p>
        ) : (
          <PropertyPicker properties={properties} />
        )}
      </div>
    </AppShell>
  );
}
