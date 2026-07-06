import { readFile } from "node:fs/promises";
import path from "node:path";
import Docxtemplater from "docxtemplater";
import ImageModule from "docxtemplater-image-module-free";
import PizZip from "pizzip";
import sharp from "sharp";
import { auth } from "@/auth";
import { downloadDriveItem, uploadFileToFolder } from "@/lib/graph";
import { formatPropertyName } from "@/lib/propertyName";
import {
  parseReportType,
  reportTypeInfo,
  type ReportType,
} from "@/lib/reportTypes";
import { supabaseAdmin } from "@/lib/supabase-admin";

// council/routine/outgoing share one layout (only the title differs);
// incident has its own template (notes log + standalone photo blocks).
const TEMPLATE_BY_TYPE: Record<ReportType, string> = {
  council: "council-inspection.docx",
  routine: "council-inspection.docx",
  outgoing: "council-inspection.docx",
  incident: "incident-report.docx",
};

function templatePath(reportType: ReportType): string {
  return path.join(process.cwd(), "src/templates", TEMPLATE_BY_TYPE[reportType]);
}
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
// Display size (px) of each photo in the Word report. The photo cell in the
// template is ~99px wide and exactly 1720 twips (~114px) tall (hRule="exact"),
// so height is sized close to the cell to fill it — portrait photos in
// particular were previously letterboxed into a short 76px box and looked small.
const REPORT_PHOTO_WIDTH = 101;
const REPORT_PHOTO_HEIGHT = 108;
// The raster is generated at this multiple of the display size so Word has
// enough real pixels to render/print the photo sharply instead of upscaling a
// display-sized thumbnail.
const REPORT_PHOTO_SCALE = 3;
const SIGNATURE_MAX_WIDTH = 180;
const SIGNATURE_MAX_HEIGHT = 45;
const INSPECTOR_COMPANY = "Upstream Property Solutions";
// The report_photos grid fills left-to-right then down. The template renders
// one three-cell table row per photo_rows entry (cells tagged c1/c2/c3), so
// this must stay in sync with the number of cN cells in the template.
const REPORT_PHOTOS_PER_ROW = 3;

type PhotoRow = {
  id: string;
  action_item_id: string;
  onedrive_file_id: string | null;
  filename: string | null;
  width: number | null;
  height: number | null;
  taken_at: string | null;
};

/** "2026-06-03" -> "3/06/2026" to match the existing report date format. */
function formatDateAU(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${m}/${y}`;
}

/** Read intrinsic dimensions from a PNG header (signature image). */
function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return { width: 250, height: 120 };
}

/**
 * Normalize every report photo into the exact same Word image box. This keeps
 * the surrounding Word table height/width stable for both landscape and portrait
 * source photos while preserving the photo aspect ratio inside the box. The
 * raster is rendered at REPORT_PHOTO_SCALE× the display size so the photo stays
 * sharp on screen and in print; the on-page size is fixed separately in getSize.
 */
async function fitReportPhotoBox(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .resize({
      width: REPORT_PHOTO_WIDTH * REPORT_PHOTO_SCALE,
      height: REPORT_PHOTO_HEIGHT * REPORT_PHOTO_SCALE,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

type FetchBytes = (driveId: string, fileId: string) => Promise<Buffer>;

/** Download bytes via `fetchBytes`; retry once before giving up. */
async function downloadWithRetry(
  fetchBytes: FetchBytes,
  driveId: string,
  fileId: string,
  label: string,
): Promise<Buffer> {
  try {
    return await fetchBytes(driveId, fileId);
  } catch {
    try {
      return await fetchBytes(driveId, fileId);
    } catch (second) {
      throw new Error(
        `Couldn't download ${label}: ${
          second instanceof Error ? second.message : "unknown error"
        }. Report not generated.`,
      );
    }
  }
}

/** Log a docxtemplater render error with all its sub-errors, for debugging. */
function logDocxError(error: unknown) {
  const e = error as {
    message?: string;
    properties?: { id?: string; explanation?: string; errors?: unknown[] };
  };
  console.error("[reportGeneration] docxtemplater render failed:", e.message);
  if (e.properties?.errors && Array.isArray(e.properties.errors)) {
    for (const sub of e.properties.errors) {
      const s = sub as {
        message?: string;
        properties?: { explanation?: string; xtag?: string };
      };
      console.error("  -", s.properties?.xtag ?? "", s.properties?.explanation ?? s.message);
    }
  } else if (e.properties?.explanation) {
    console.error("  -", e.properties.explanation);
  }
}

export type RenderedReport = {
  buffer: Buffer;
  inspection: {
    property_name: string;
    inspection_date: string;
    report_title: string;
    onedrive_drive_id: string;
    onedrive_subfolder_id: string;
  };
};

/**
 * Build the report .docx buffer from an inspection's current action_items,
 * photos and signature. Pure read + render — no auth/session dependency, no
 * upload, no DB writes. `fetchBytes` lets the caller supply either the
 * session-based or app-only Graph download function, so this same core can
 * back both the inspector's authenticated generate flow and the reviewer's
 * unauthenticated download route.
 */
export async function renderReportDocx(
  inspectionId: string,
  fetchBytes: FetchBytes,
): Promise<RenderedReport> {
  const sb = supabaseAdmin();

  // 1. Inspection + inspector.
  const { data: inspection, error: insErr } = await sb
    .from("inspections")
    .select(
      "id, property_name, inspection_date, report_type, status, onedrive_drive_id, onedrive_subfolder_id, user_id",
    )
    .eq("id", inspectionId)
    .single();
  if (insErr || !inspection) throw new Error("Inspection not found.");
  // Folder names are filed as "Suburb, Street, Number"; the report and any
  // downstream filenames should read as a normal address.
  const displayPropertyName = formatPropertyName(inspection.property_name);
  const reportType = parseReportType(inspection.report_type);
  const report = reportTypeInfo(inspection.report_type);
  const isIncident = reportType === "incident";

  const { data: user, error: userErr } = await sb
    .from("users")
    .select("name, position, signature_path")
    .eq("id", inspection.user_id)
    .single();
  if (userErr || !user) throw new Error("Inspector record not found.");

  // 2. Action items (ordered) + their photos (ordered).
  const { data: items, error: itemErr } = await sb
    .from("action_items")
    .select("id, area, comment")
    .eq("inspection_id", inspectionId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (itemErr) throw new Error(`Failed to load action items: ${itemErr.message}`);

  // Incident reports: the narrative notes for the first-page log. For an
  // incident, "action items" are really per-entry photo groups, so either
  // notes or photo entries make the report non-empty.
  let notes: { text: string }[] = [];
  if (isIncident) {
    const { data: noteData, error: noteErr } = await sb
      .from("incident_notes")
      .select("text")
      .eq("inspection_id", inspectionId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (noteErr) throw new Error(`Failed to load notes: ${noteErr.message}`);
    notes = (noteData ?? []).map((n) => ({ text: n.text ?? "" }));
    if (notes.length === 0 && (!items || items.length === 0)) {
      throw new Error("Add at least one note or photo before generating.");
    }
  } else if (!items || items.length === 0) {
    throw new Error("Add at least one action item before generating.");
  }
  const itemList = items ?? [];

  const { data: photoData, error: photoErr } = await sb
    .from("photos")
    .select("id, action_item_id, onedrive_file_id, filename, width, height, taken_at")
    .in(
      "action_item_id",
      itemList.map((i) => i.id),
    )
    .order("taken_at", { ascending: true });
  if (photoErr) throw new Error(`Failed to load photos: ${photoErr.message}`);
  const photos = (photoData ?? []) as PhotoRow[];
  const unsynced = photos.filter((p) => !p.onedrive_file_id);
  if (unsynced.length > 0) {
    throw new Error(
      `${unsynced.length} photo${unsynced.length === 1 ? "" : "s"} still syncing. Leave the capture screen open until syncing finishes, then generate again.`,
    );
  }

  const photosByItem = new Map<string, PhotoRow[]>();
  for (const p of photos) {
    const arr = photosByItem.get(p.action_item_id) ?? [];
    arr.push(p);
    photosByItem.set(p.action_item_id, arr);
  }

  const driveId = inspection.onedrive_drive_id;

  // 3. Download each unique photo's bytes (cache by file id, retry once).
  const bytesByFileId = new Map<string, Buffer>();
  const reportImageByFileId = new Map<string, Buffer>();
  for (const p of photos) {
    const fileId = p.onedrive_file_id!;
    if (!bytesByFileId.has(fileId)) {
      const originalBytes = await downloadWithRetry(
        fetchBytes,
        driveId,
        fileId,
        `photo ${p.filename ?? p.id}`,
      );
      bytesByFileId.set(fileId, originalBytes);
      reportImageByFileId.set(
        fileId,
        await fitReportPhotoBox(originalBytes),
      );
    }
  }

  // 4. Signature from Supabase Storage.
  if (!user.signature_path) {
    throw new Error(
      "No signature on file. Add one in Account before generating a report.",
    );
  }
  const { data: sigBlob, error: sigErr } = await sb.storage
    .from("signatures")
    .download(`${inspection.user_id}.png`);
  if (sigErr || !sigBlob) {
    throw new Error("Couldn't load your signature image. Re-save it in Account.");
  }
  const signatureBytes = Buffer.from(await sigBlob.arrayBuffer());

  // 5. Template data + a value->size map the image module reads in getSize.
  // Comments are already reviewed/finalised in the app, so they're used as-is.
  const sizeByValue = new Map<unknown, { width: number; height: number }>();

  let nextPhotoNumber = 1;
  const action_items = itemList.map((item, i) => {
    const itemPhotos = photosByItem.get(item.id) ?? [];
    const photoNumbers = itemPhotos.map(() => nextPhotoNumber++);
    return {
      number: i + 1,
      area: item.area,
      comment: item.comment ?? "",
      image_refs: photoNumbers.join(", "),
      photos: itemPhotos.map((p, j) => {
        const reportImage = reportImageByFileId.get(p.onedrive_file_id!)!;
        sizeByValue.set(reportImage, {
          width: REPORT_PHOTO_WIDTH,
          height: REPORT_PHOTO_HEIGHT,
        });
        return {
          image: reportImage,
          width: p.width ?? 0,
          height: p.height ?? 0,
          number: photoNumbers[j],
          photo_index: j + 1,
        };
      }),
    };
  });
  sizeByValue.set(signatureBytes, pngSize(signatureBytes));

  const report_photos = action_items.flatMap((item) =>
    item.photos.map((photo) => ({
      ...photo,
      area: item.area,
      comment: item.comment,
    })),
  );

  // Grouped into fixed-size rows for the template's grid table, which loops
  // row-by-row (left-to-right, then down) rather than Word's column-major
  // multi-column flow. Each row maps photos to cell tags c1..cN; a missing
  // cell (last partial row) renders as an empty grid cell.
  type ReportPhoto = (typeof report_photos)[number];
  const photo_rows: Record<string, ReportPhoto>[] = [];
  for (let i = 0; i < report_photos.length; i += REPORT_PHOTOS_PER_ROW) {
    const row: Record<string, ReportPhoto> = {};
    report_photos.slice(i, i + REPORT_PHOTOS_PER_ROW).forEach((photo, j) => {
      row[`c${j + 1}`] = photo;
    });
    photo_rows.push(row);
  }

  const data = {
    property_name: displayPropertyName,
    report_title: report.title,
    inspection_date: formatDateAU(inspection.inspection_date),
    inspector_name: user.name,
    inspector_position: user.position ?? "",
    inspector_company: INSPECTOR_COMPANY,
    // The incident template swaps the action-items table for the first-page
    // narrative log; its photo pages use the exact photo_rows grid the other
    // report templates share.
    ...(isIncident ? { notes } : { action_items }),
    photo_rows,
    signature: signatureBytes,
  };

  // 6. Render the template.
  const imageModule = new ImageModule({
    centered: false,
    getImage: (tagValue) => tagValue as Buffer,
    getSize: (_img, tagValue, tagName) => {
      const dims = sizeByValue.get(tagValue) ?? { width: 600, height: 450 };
      if (tagName === "signature") {
        const scale = Math.min(
          SIGNATURE_MAX_WIDTH / dims.width,
          SIGNATURE_MAX_HEIGHT / dims.height,
          1,
        );
        return [
          Math.round(dims.width * scale),
          Math.round(dims.height * scale),
        ];
      }
      if (tagName === "image") {
        return [REPORT_PHOTO_WIDTH, REPORT_PHOTO_HEIGHT];
      }
      // Photos: landscape caps width at 600, portrait caps height at 700.
      if (dims.width >= dims.height) {
        const w = Math.min(dims.width, 600);
        return [w, Math.round((w * dims.height) / dims.width)];
      }
      const h = Math.min(dims.height, 700);
      return [Math.round((h * dims.width) / dims.height), h];
    },
  });

  const templateBuffer = await readFile(templatePath(reportType));
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
  });

  try {
    // renderAsync (not render) is required: the image module resolves image
    // sizes asynchronously, and sync render leaves sizePixel undefined.
    await doc.renderAsync(data);
  } catch (error) {
    logDocxError(error);
    throw new Error(
      "Report template failed to render. The placeholders may not match the data — see server logs.",
    );
  }

  const out = doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;

  return {
    buffer: out,
    inspection: {
      property_name: displayPropertyName,
      inspection_date: inspection.inspection_date,
      report_title: report.title,
      onedrive_drive_id: driveId,
      onedrive_subfolder_id: inspection.onedrive_subfolder_id,
    },
  };
}

/**
 * Inspector-facing entrypoint: session-gated, renders via renderReportDocx,
 * uploads the result into the inspection's dated OneDrive subfolder, and
 * marks the inspection generated. Unchanged behavior from before the
 * renderReportDocx extraction.
 */
export async function generateReport(
  inspectionId: string,
): Promise<{ docOnedriveId: string; docWebUrl: string }> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const { buffer, inspection } = await renderReportDocx(
    inspectionId,
    downloadDriveItem,
  );

  // Upload the .docx into the inspection's dated subfolder.
  const safeProperty = inspection.property_name.replace(/[\\/:*?"<>|]/g, "-");
  const generatedAt = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const safeReportTitle = inspection.report_title.replace(/[\\/:*?"<>|]/g, "-");
  const filename = `${safeReportTitle} - ${safeProperty} - ${inspection.inspection_date} - ${generatedAt}.docx`;
  const uploaded = await uploadFileToFolder(
    inspection.onedrive_drive_id,
    inspection.onedrive_subfolder_id,
    filename,
    buffer,
    DOCX_MIME,
  );

  // Mark generated.
  const { error: updateErr } = await supabaseAdmin()
    .from("inspections")
    .update({ status: "generated", generated_doc_onedrive_id: uploaded.id })
    .eq("id", inspectionId);
  if (updateErr) {
    throw new Error(`Report uploaded but status update failed: ${updateErr.message}`);
  }

  return { docOnedriveId: uploaded.id, docWebUrl: uploaded.webUrl };
}
