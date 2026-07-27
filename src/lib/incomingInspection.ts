export const INSPECTION_CONDITIONS = ["new", "good", "fair", "poor"] as const;

export type InspectionCondition = (typeof INSPECTION_CONDITIONS)[number];

export type IncomingServiceRow = {
  id: string;
  type: string;
  location?: string;
  lastServiceDate: string;
};

/** One free-text "Other Comments" entry, added on its own in the field. */
export type IncomingCommentRow = {
  id: string;
  text: string;
  /**
   * Last AI-polished wording for this comment, mirroring action_items.ai_comment
   * and incident_notes.ai_text. Cached so re-opening the review page reuses the
   * suggestion instead of paying for another OpenAI call.
   */
  aiText?: string;
};

export type IncomingInspectionDetails = {
  streetAddress: string;
  suburb: string;
  propertyType: string;
  propertyArea: string;
  tenantCompany: string;
  tenantContactName: string;
  tenantContactNumber: string;
  leaseTerm: string;
  commencement: string;
  electricalNmi: string;
  electricalMsbLocation: string;
  electricalCapacity: string;
  electricalDbCount: string;
  hvacUnits: IncomingServiceRow[];
  fireServices: IncomingServiceRow[];
  otherComments: IncomingCommentRow[];
};

const EMPTY_INCOMING_DETAILS: IncomingInspectionDetails = {
  streetAddress: "",
  suburb: "",
  propertyType: "",
  propertyArea: "",
  tenantCompany: "",
  tenantContactName: "",
  tenantContactNumber: "",
  leaseTerm: "",
  commencement: "",
  electricalNmi: "",
  electricalMsbLocation: "",
  electricalCapacity: "",
  electricalDbCount: "",
  hvacUnits: [],
  fireServices: [],
  otherComments: [],
};

export function deriveIncomingAddress(propertyName: string): {
  streetAddress: string;
  suburb: string;
} {
  const parts = propertyName.split(",").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return { streetAddress: propertyName, suburb: "" };
  }
  const [suburb, street, number] = parts;
  return { streetAddress: `${number} ${street}`, suburb };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function serviceRows(value: unknown, withLocation: boolean): IncomingServiceRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row, index) => {
    const item =
      row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    return {
      // Rows saved by incomingDetailsToRow always carry an id. For older or
      // hand-edited rows that don't, fall back to a positional id rather than
      // a fresh UUID: this runs on every server render, and a new id each time
      // would churn React keys and break edits keyed on it.
      id: clean(item.id) || `${withLocation ? "hvac" : "fire"}-${index}`,
      type: clean(item.type),
      ...(withLocation ? { location: clean(item.location) } : {}),
      lastServiceDate: clean(item.lastServiceDate),
    };
  });
}

function commentRows(value: unknown): IncomingCommentRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row, index) => {
    const item =
      row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const aiText = clean(item.aiText);
    return {
      id: clean(item.id) || `comment-${index}`,
      text: clean(item.text),
      ...(aiText ? { aiText } : {}),
    };
  });
}

/** Whether one HVAC/fire row has every field the report needs. */
export function isServiceRowComplete(
  row: IncomingServiceRow,
  withLocation: boolean,
): boolean {
  return Boolean(
    clean(row.type) &&
      clean(row.lastServiceDate) &&
      (!withLocation || clean(row.location)),
  );
}

export function incomingDetailsFromRow(
  row: Record<string, unknown> | null | undefined,
  propertyName: string,
): IncomingInspectionDetails {
  const derived = deriveIncomingAddress(propertyName);
  if (!row) {
    return {
      ...EMPTY_INCOMING_DETAILS,
      streetAddress: derived.streetAddress,
      suburb: derived.suburb,
    };
  }
  return {
    streetAddress: clean(row.street_address) || derived.streetAddress,
    suburb: clean(row.suburb) || derived.suburb,
    propertyType: clean(row.property_type),
    propertyArea: clean(row.property_area),
    tenantCompany: clean(row.tenant_company),
    tenantContactName: clean(row.tenant_contact_name),
    tenantContactNumber: clean(row.tenant_contact_number),
    leaseTerm: clean(row.lease_term),
    commencement: clean(row.commencement),
    electricalNmi: clean(row.electrical_nmi),
    electricalMsbLocation: clean(row.electrical_msb_location),
    electricalCapacity: clean(row.electrical_capacity),
    electricalDbCount: clean(row.electrical_db_count),
    hvacUnits: serviceRows(row.hvac_units, true),
    fireServices: serviceRows(row.fire_services, false),
    otherComments: commentRows(row.other_comments),
  };
}

export function incomingDetailsToRow(details: IncomingInspectionDetails) {
  return {
    street_address: clean(details.streetAddress),
    suburb: clean(details.suburb),
    property_type: clean(details.propertyType),
    property_area: clean(details.propertyArea),
    tenant_company: clean(details.tenantCompany),
    tenant_contact_name: clean(details.tenantContactName),
    tenant_contact_number: clean(details.tenantContactNumber),
    lease_term: clean(details.leaseTerm),
    commencement: clean(details.commencement),
    electrical_nmi: clean(details.electricalNmi),
    electrical_msb_location: clean(details.electricalMsbLocation),
    electrical_capacity: clean(details.electricalCapacity),
    electrical_db_count: clean(details.electricalDbCount),
    hvac_units: details.hvacUnits.map((row) => ({
      id: clean(row.id),
      type: clean(row.type),
      location: clean(row.location),
      lastServiceDate: clean(row.lastServiceDate),
    })),
    fire_services: details.fireServices.map((row) => ({
      id: clean(row.id),
      type: clean(row.type),
      lastServiceDate: clean(row.lastServiceDate),
    })),
    other_comments: details.otherComments.map((row) => ({
      id: clean(row.id),
      text: clean(row.text),
      // Preserved on save so a suggestion generated on the review page isn't
      // lost the moment the reviewer saves anything else.
      ...(clean(row.aiText) ? { aiText: clean(row.aiText) } : {}),
    })),
    updated_at: new Date().toISOString(),
  };
}

export function validateIncomingDetails(
  details: IncomingInspectionDetails,
): string[] {
  const missing: string[] = [];
  const required: Array<[string, string]> = [
    ["Street address", details.streetAddress],
    ["Suburb", details.suburb],
    ["Property type", details.propertyType],
    ["Area", details.propertyArea],
    ["Tenant company", details.tenantCompany],
    ["Tenant contact name", details.tenantContactName],
    ["Tenant contact number", details.tenantContactNumber],
    ["Lease term", details.leaseTerm],
    ["Commencement", details.commencement],
    ["Electrical NMI", details.electricalNmi],
    ["MSB location", details.electricalMsbLocation],
    ["Electrical capacity", details.electricalCapacity],
    ["Number of DBs", details.electricalDbCount],
  ];
  for (const [label, value] of required) {
    if (!clean(value)) missing.push(label);
  }
  details.hvacUnits.forEach((row, index) => {
    if (!clean(row.type)) missing.push(`HVAC ${index + 1} type`);
    if (!clean(row.location)) {
      missing.push(`HVAC ${index + 1} outdoor unit location`);
    }
    if (!clean(row.lastServiceDate)) {
      missing.push(`HVAC ${index + 1} last service date`);
    }
  });
  details.fireServices.forEach((row, index) => {
    if (!clean(row.type)) missing.push(`Fire service ${index + 1} type`);
    if (!clean(row.lastServiceDate)) {
      missing.push(`Fire service ${index + 1} last service date`);
    }
  });
  // Comments are optional as a section, but an added row left blank would
  // render as an empty line in the report's Other Comments table.
  details.otherComments.forEach((row, index) => {
    if (!clean(row.text)) missing.push(`Other comment ${index + 1}`);
  });
  return missing;
}

export function formatCondition(condition: string | null | undefined): string {
  return condition
    ? `${condition.charAt(0).toUpperCase()}${condition.slice(1).toLowerCase()}`
    : "";
}
