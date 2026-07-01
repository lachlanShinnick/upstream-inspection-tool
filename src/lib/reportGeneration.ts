import { readFile } from "node:fs/promises";
import path from "node:path";
import Docxtemplater from "docxtemplater";
import ImageModule from "docxtemplater-image-module-free";
import PizZip from "pizzip";
import sharp from "sharp";
import { auth } from "@/auth";
import { downloadDriveItem, uploadFileToFolder } from "@/lib/graph";
import { supabaseAdmin } from "@/lib/supabase-admin";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "src/templates/council-inspection.docx",
);
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const REPORT_PHOTO_WIDTH = 101;
const REPORT_PHOTO_HEIGHT = 76;
const SIGNATURE_MAX_WIDTH = 180;
const SIGNATURE_MAX_HEIGHT = 45;
const INSPECTOR_COMPANY = "Upstream Property Solutions";

type PhotoRow = {
  id: string;
  action_item_id: string;
  onedrive_file_id: string;
  filename: string;
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
 * source photos while preserving the photo aspect ratio inside the box.
 */
async function fitReportPhotoBox(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .resize({
      width: REPORT_PHOTO_WIDTH,
      height: REPORT_PHOTO_HEIGHT,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
}

/** Download bytes; retry once before giving up. */
async function downloadWithRetry(
  driveId: string,
  fileId: string,
  label: string,
): Promise<Buffer> {
  try {
    return await downloadDriveItem(driveId, fileId);
  } catch {
    try {
      return await downloadDriveItem(driveId, fileId);
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

export async function generateReport(
  inspectionId: string,
): Promise<{ docOnedriveId: string; docWebUrl: string }> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const sb = supabaseAdmin();

  // 1. Inspection + inspector.
  const { data: inspection, error: insErr } = await sb
    .from("inspections")
    .select(
      "id, property_name, inspection_date, status, onedrive_drive_id, onedrive_subfolder_id, user_id",
    )
    .eq("id", inspectionId)
    .single();
  if (insErr || !inspection) throw new Error("Inspection not found.");

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
  if (!items || items.length === 0) {
    throw new Error("Add at least one action item before generating.");
  }

  const { data: photoData, error: photoErr } = await sb
    .from("photos")
    .select("id, action_item_id, onedrive_file_id, filename, width, height, taken_at")
    .in(
      "action_item_id",
      items.map((i) => i.id),
    )
    .order("taken_at", { ascending: true });
  if (photoErr) throw new Error(`Failed to load photos: ${photoErr.message}`);
  const photos = (photoData ?? []) as PhotoRow[];

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
    if (!bytesByFileId.has(p.onedrive_file_id)) {
      const originalBytes = await downloadWithRetry(
        driveId,
        p.onedrive_file_id,
        `photo ${p.filename}`,
      );
      bytesByFileId.set(p.onedrive_file_id, originalBytes);
      reportImageByFileId.set(
        p.onedrive_file_id,
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
  const sizeByValue = new Map<unknown, { width: number; height: number }>();

  let nextPhotoNumber = 1;
  const action_items = items.map((item, i) => {
    const itemPhotos = photosByItem.get(item.id) ?? [];
    const photoNumbers = itemPhotos.map(() => nextPhotoNumber++);
    return {
      number: i + 1,
      area: item.area,
      comment: item.comment ?? "",
      image_refs: photoNumbers.join(", "),
      photos: itemPhotos.map((p, j) => {
        const reportImage = reportImageByFileId.get(p.onedrive_file_id)!;
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

  const data = {
    property_name: inspection.property_name,
    inspection_date: formatDateAU(inspection.inspection_date),
    inspector_name: user.name,
    inspector_position: user.position ?? "",
    inspector_company: INSPECTOR_COMPANY,
    action_items,
    report_photos,
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

  const templateBuffer = await readFile(TEMPLATE_PATH);
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

  // 7. Upload the .docx into the inspection's dated subfolder.
  const safeProperty = inspection.property_name.replace(/[\\/:*?"<>|]/g, "-");
  const generatedAt = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const filename = `Council Inspection Report - ${safeProperty} - ${inspection.inspection_date} - ${generatedAt}.docx`;
  const uploaded = await uploadFileToFolder(
    driveId,
    inspection.onedrive_subfolder_id,
    filename,
    out,
    DOCX_MIME,
  );

  // 8. Mark generated.
  const { error: updateErr } = await sb
    .from("inspections")
    .update({ status: "generated", generated_doc_onedrive_id: uploaded.id })
    .eq("id", inspectionId);
  if (updateErr) {
    throw new Error(`Report uploaded but status update failed: ${updateErr.message}`);
  }

  return { docOnedriveId: uploaded.id, docWebUrl: uploaded.webUrl };
}
