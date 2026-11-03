/**
 * Renders a demo file for every seeded document and query letter and uploads it
 * to the PRIVATE `patient-files` bucket (service-role key, server-side only).
 *   npm run seed:storage        (after `supabase db reset`)
 *
 * PDFs are drawn with pdf-lib; .jpg "scans" are drawn with sharp from SVG.
 * The Dengue pharmacy slips are rendered faded on purpose (illegible scan test).
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { LETTERS, PATIENTS, type DocSeed, type PatientSeed } from "./fixtures/seed-data";
import { BUCKET, documentPath, queryLetterPath } from "./fixtures/paths";

loadEnv({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const TITLES: Record<string, string> = {
  DISCHARGE_SUMMARY: "DISCHARGE SUMMARY",
  FINAL_BILL: "FINAL HOSPITAL BILL",
  INVESTIGATION_REPORT: "INVESTIGATION REPORT",
  CONSULTATION_PAPER: "CONSULTATION / OPD PAPER",
  PHARMACY_BILL: "PHARMACY BILL",
  POLICY_COPY: "HEALTH INSURANCE POLICY SCHEDULE",
  KYC: "IDENTITY DOCUMENT (MASKED)",
  CANCELLED_CHEQUE: "CANCELLED CHEQUE",
  OTHER: "DOCUMENT",
};

async function renderPdf(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]); // A4
  let y = 790;
  lines.forEach((line, i) => {
    // pdf-lib standard fonts are WinAnsi only; replace anything else.
    const text = line.replace(/[^\x20-\x7E]/g, "-");
    const f = i === 0 ? bold : font;
    const size = i === 0 ? 14 : 11;
    // naive wrap at ~90 chars
    const chunks = text.match(/.{1,90}(\s|$)/g) ?? [text];
    for (const c of chunks) {
      page.drawText(c.trim(), { x: 50, y, size, font: f, color: rgb(0.1, 0.1, 0.15) });
      y -= size + 8;
    }
    if (i === 0) y -= 8;
  });
  page.drawText("DEMO DOCUMENT - FICTIONAL DATA", { x: 50, y: 40, size: 8, font, color: rgb(0.6, 0.6, 0.6) });
  return pdf.save();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function renderJpeg(lines: string[], faded: boolean): Promise<Buffer> {
  const fill = faded ? "#c9c9c9" : "#222";
  const rows = lines
    .map((l, i) => `<text x="40" y="${70 + i * 34}" font-family="Arial" font-size="${i === 0 ? 24 : 20}" fill="${fill}" ${i === 0 ? 'font-weight="bold"' : ""}>${esc(l)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${140 + lines.length * 34}">
    <rect width="100%" height="100%" fill="${faded ? "#f3efe4" : "#fbfbf8"}"/>${rows}</svg>`;
  let img = sharp(Buffer.from(svg));
  if (faded) img = img.blur(1.2);
  return img.jpeg({ quality: faded ? 45 : 85 }).toBuffer();
}

function docLines(p: PatientSeed, d: DocSeed): string[] {
  return [
    TITLES[d.type],
    ...(d.hospital ? [d.hospital] : []),
    `Patient: ${p.full_name}`,
    `Date: ${d.date.split("-").reverse().join("-")}`,
    ...d.body,
  ];
}

async function upload(path: string, body: Uint8Array | Buffer, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`${path}: ${error.message}`);
}

async function main() {
  let n = 0;
  for (const p of PATIENTS) {
    for (const d of p.docs) {
      const path = documentPath(p.id, d.id, d.name);
      const isImg = d.name.endsWith(".jpg");
      const body = isImg
        ? await renderJpeg(docLines(p, d), d.facts.legible === "partly")
        : await renderPdf(docLines(p, d));
      await upload(path, body, isImg ? "image/jpeg" : "application/pdf");
      await supabase.from("documents").update({ size_bytes: body.length }).eq("id", d.id);
      n++;
    }
  }
  for (const l of LETTERS) {
    await upload(queryLetterPath(l.patient_id, l.id, l.file_name), await renderPdf(l.lines), "application/pdf");
    n++;
  }
  console.log(`uploaded ${n} files to private bucket "${BUCKET}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
