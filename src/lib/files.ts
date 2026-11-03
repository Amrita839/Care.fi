import "server-only";
import sharp from "sharp";
import type { LlmPart } from "@/lib/llm/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { BUCKET, MAX_FILE_BYTES } from "@/lib/files-shared";
export { BUCKET, MAX_FILE_BYTES, ACCEPTED_MIME } from "@/lib/files-shared";

/** Errors that will never succeed on retry (bad file). The pipeline marks these NEEDS_REVIEW instead of retrying. */
export class BadFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadFileError";
  }
}

export async function downloadFile(path: string): Promise<{ bytes: Buffer; mime: string }> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`storage download failed: ${error?.message ?? "no data"}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  return { bytes, mime: sniffMime(bytes, data.type) };
}

/** Trust magic bytes over the stored content-type. */
export function sniffMime(b: Buffer, fallback = "application/octet-stream"): string {
  if (b.length < 12) return fallback;
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (["II*\0", "MM\0*"].includes(b.subarray(0, 4).toString("latin1"))) return "image/tiff";
  if (b.subarray(4, 12).toString("latin1").startsWith("ftyphei") || b.subarray(4, 12).toString("latin1").startsWith("ftypmif")) return "image/heic";
  return fallback;
}

/**
 * Turns a stored file into provider-neutral model content.
 * - PDFs go in natively (Gemini/Claude read text + page images; capped at 100 pages).
 * - Images are auto-rotated from EXIF, downscaled to 1568px long edge, re-encoded as JPEG,
 *   and rejected if blank / tiny (unreadable photo).
 */
export async function toLlmContent(bytes: Buffer, mime: string): Promise<LlmPart[]> {
  if (bytes.length === 0) throw new BadFileError("The file is empty.");
  if (bytes.length > MAX_FILE_BYTES) throw new BadFileError("The file is larger than 25 MB.");

  if (mime === "application/pdf") {
    const raw = bytes.toString("latin1");
    if (/\/Encrypt\b/.test(raw)) throw new BadFileError("The PDF is password-protected.");
    const pages = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    if (pages > 100) throw new BadFileError(`The PDF has ${pages} pages; the limit is 100.`);
    return [{ type: "file", mime: "application/pdf", data: bytes.toString("base64") }];
  }

  if (mime.startsWith("image/")) {
    let img: ReturnType<typeof sharp>;
    try {
      img = sharp(bytes, { failOn: "none" }).rotate(); // EXIF auto-orient
      const meta = await img.metadata();
      if (!meta.width || !meta.height) throw new Error("no dimensions");
      if (Math.min(meta.width, meta.height) < 200) throw new BadFileError("The image is too small to read.");
      const stats = await sharp(bytes, { failOn: "none" }).stats();
      const spread = Math.max(...stats.channels.map((c) => c.stdev));
      if (spread < 4) throw new BadFileError("The image looks blank.");
    } catch (e) {
      if (e instanceof BadFileError) throw e;
      throw new BadFileError(`The image could not be opened (${mime}).`);
    }
    const jpeg = await img
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return [{ type: "file", mime: "image/jpeg", data: jpeg.toString("base64") }];
  }
  throw new BadFileError(`Unsupported file type: ${mime}`);
}
