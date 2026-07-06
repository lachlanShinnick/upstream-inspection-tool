export const REPORT_TYPES = {
  council: {
    label: "Council Inspection",
    newLabel: "New Council Inspection",
    title: "Council Inspection Report",
    folderSuffix: "Council Inspection",
  },
  routine: {
    label: "Routine Inspection",
    newLabel: "New Routine Inspection",
    title: "Routine Inspection Report",
    folderSuffix: "Routine Inspection",
  },
  outgoing: {
    label: "Outgoing Inspection",
    newLabel: "New Outgoing Inspection Report",
    title: "Outgoing Inspection Report",
    folderSuffix: "Outgoing Inspection Report",
  },
  incident: {
    label: "Incident Report",
    newLabel: "New Incident Report",
    title: "Incident Report",
    folderSuffix: "Incident Report",
  },
} as const;

export type ReportType = keyof typeof REPORT_TYPES;

export const DEFAULT_REPORT_TYPE: ReportType = "council";

export function parseReportType(value: string | null | undefined): ReportType {
  return value && value in REPORT_TYPES
    ? (value as ReportType)
    : DEFAULT_REPORT_TYPE;
}

export function reportTypeInfo(value: string | null | undefined) {
  return REPORT_TYPES[parseReportType(value)];
}
