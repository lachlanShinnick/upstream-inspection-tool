/**
 * SharePoint property folders are named "Suburb, Street, Number" (filing
 * order, e.g. "Adelaide, Currie Street, 129") so they sort sensibly in a
 * folder list. That's stored verbatim as inspections.property_name since it
 * also has to match the OneDrive folder. This reformats it to a normal
 * street-address reading order — "129 Currie Street, Adelaide" — for display
 * only. Anything that isn't exactly the three-part pattern is left as-is.
 */
export function formatPropertyName(name: string): string {
  const parts = name.split(",").map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !p)) return name;
  const [suburb, street, number] = parts;
  return `${number} ${street}, ${suburb}`;
}
