/**
 * End-to-end run of 5 sample query letters through the REAL pipeline
 * (Supabase + Inngest + Claude; Twilio/Resend only if E2E_SEND=1).
 *
 *   # terminal 1: npm run dev     terminal 2: npm run inngest
 *   npm run e2e
 *
 * By default auto-send is switched OFF for the run (messages become DRAFTs, nothing
 * is sent to the fake seeded numbers) and restored afterwards.
 * To really send: E2E_SEND=1 E2E_PHONE=+91XXXXXXXXXX E2E_EMAIL=you@x.com npm run e2e
 * (the phone must have joined your Twilio sandbox).
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Inngest } from "inngest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import sharp from "sharp";
import { PATIENTS } from "./fixtures/seed-data";
import { BUCKET, queryLetterPath } from "./fixtures/paths";

loadEnv({ path: ".env.local" });
process.env.INNGEST_DEV ??= "1";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const inngest = new Inngest({ id: "patient-locker" });
const SEND = process.env.E2E_SEND === "1";
const TERMINAL = ["SENT", "PARTIALLY_SENT", "FAILED", "NEEDS_REVIEW", "RESOLVED"];

async function pdf(lines: string[], opts: { pages?: number; rotate?: number } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = opts.pages ?? 1;
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    if (opts.rotate) page.setRotation(degrees(opts.rotate));
    const body = p === pages - 1 ? lines : [`Annexure page ${p + 1} - claim history and terms (no requests on this page).`, ...Array(25).fill("Standard terms and conditions apply as per policy wording.")];
    body.forEach((l, i) => page.drawText(l.replace(/[^\x20-\x7E]/g, "-"), { x: 50, y: 790 - i * 20, size: 11, font }));
  }
  return Buffer.from(await doc.save());
}

async function rotatedPhoto(lines: string[]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${120 + lines.length * 40}"><rect width="100%" height="100%" fill="#f6f4ee"/>${lines
    .map((l, i) => `<text x="40" y="${70 + i * 40}" font-family="Arial" font-size="24" fill="#222">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`)
    .join("")}</svg>`;
  return sharp(Buffer.from(svg)).rotate(90).jpeg({ quality: 80 }).toBuffer(); // a sideways phone photo, no EXIF
}

interface Case {
  name: string;
  patient: number; // index into PATIENTS (1-based)
  file: () => Promise<Buffer>;
  ext: "pdf" | "jpg";
  expect: (r: Result) => string | null; // null = pass
}
interface Result {
  status: string;
  points: { point_no: number; decision: string | null; needed_doc_type: string | null; needs_review: boolean; point_text: string }[];
  ms: number;
  review_reason: string | null;
}

const neverReasksExisting = (r: Result, patientIdx: number) => {
  const have = new Set(PATIENTS[patientIdx - 1].docs.map((d) => d.type));
  const bad = r.points.filter(
    (p) => p.decision === "NEED_FROM_PATIENT" && !p.needs_review && p.needed_doc_type && have.has(p.needed_doc_type as never) &&
      !/illegible|unclear|incomplete|fresh|clear cop|original|wrong|signed|updated/i.test(p.point_text),
  );
  return bad.length ? `asked patient again for existing ${bad.map((b) => b.needed_doc_type).join(", ")}` : null;
};

const CASES: Case[] = [
  {
    name: "1. ICICI 5-point letter (summary bill, implant, MLC, X-ray, policy)",
    patient: 3,
    ext: "pdf",
    file: () => pdf([
      "ICICI LOMBARD (demo) - Claim No: IL-CL-7720931",
      "Patient: Mohammed Irfan Shaikh",
      "1. Itemised final bill. The bill submitted is a summary bill without break-up.",
      "2. Implant sticker / invoice for the volar locking plate used.",
      "3. MLC / FIR copy, or a declaration from the treating doctor that the injury is not medico-legal.",
      "4. Post-operative X-ray report.",
      "5. Copy of policy document.",
    ]),
    expect: (r) => (r.points.length !== 5 ? `expected 5 points, got ${r.points.length}` : neverReasksExisting(r, 3)),
  },
  {
    name: "2. Illegible pharmacy bills (explicit re-request) + cheque",
    patient: 2,
    ext: "pdf",
    file: () => pdf([
      "HDFC ERGO (demo) - Claim Ref: RR-HE-990011",
      "a) Pharmacy bills submitted are illegible. Please submit clear copies.",
      "b) Cancelled cheque bearing the name of the proposer.",
    ]),
    expect: (r) => {
      const pharm = r.points.find((p) => p.needed_doc_type === "PHARMACY_BILL");
      if (!pharm || pharm.decision !== "NEED_FROM_PATIENT") return "illegible pharmacy bill should be NEED_FROM_PATIENT";
      return r.points.length === 2 ? null : `expected 2 points, got ${r.points.length}`;
    },
  },
  {
    name: "3. Sideways phone photo of a letter (rotated scan)",
    patient: 7,
    ext: "jpg",
    file: () => rotatedPhoto([
      "ADITYA BIRLA HEALTH (demo) Claim: ABH-55-1203",
      "Please submit: 1) Chest X-ray report. 2) Cancelled cheque. 3) Aadhaar copy of patient.",
    ]),
    expect: (r) => (r.points.length >= 3 ? neverReasksExisting(r, 7) : `expected 3 points, got ${r.points.length}`),
  },
  {
    name: "4. 20-page PDF, asks on the last page only",
    patient: 8,
    ext: "pdf",
    file: () => pdf([
      "TATA AIG (demo) - Claim TA-CL-44120",
      "Requirement: Histopathology report of the removed appendix.",
      "Requirement: First consultation paper with date of onset of pain.",
    ], { pages: 20 }),
    expect: (r) => (r.points.length === 2 ? null : `expected 2 points, got ${r.points.length}`),
  },
  {
    name: "5. Empty letter (no requests)",
    patient: 10,
    ext: "pdf",
    file: () => pdf(["NIVA BUPA (demo)", "Dear Sir/Madam,", "This is to acknowledge receipt of your claim.", "Regards, Claims Team"]),
    expect: (r) => (r.status === "NEEDS_REVIEW" && r.points.length === 0 ? null : `expected NEEDS_REVIEW with 0 points, got ${r.status}/${r.points.length}`),
  },
];

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Fill .env.local first");
  const { data: settings } = await db.from("app_settings").select("auto_send").single();
  const original = settings?.auto_send ?? true;
  await db.from("app_settings").update({ auto_send: SEND }).eq("id", true);
  const restoreContacts: { id: string; phone: string; email: string }[] = [];
  if (SEND && (process.env.E2E_PHONE || process.env.E2E_EMAIL)) {
    for (const c of CASES) {
      const p = PATIENTS[c.patient - 1];
      restoreContacts.push({ id: p.id, phone: p.phone, email: p.email });
      await db.from("patients").update({ phone: process.env.E2E_PHONE ?? p.phone, email: process.env.E2E_EMAIL ?? p.email }).eq("id", p.id);
    }
  }

  console.log(`Running ${CASES.length} letters (${SEND ? "REAL SEND" : "drafts only, nothing sent"})…\n`);
  const started = Date.now();
  const runs = await Promise.all(
    CASES.map(async (c) => {
      const p = PATIENTS[c.patient - 1];
      const id = crypto.randomUUID();
      const name = `e2e-${p.code}-${Date.now()}.${c.ext}`;
      const path = queryLetterPath(p.id, id, name);
      const bytes = await c.file();
      const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: c.ext === "pdf" ? "application/pdf" : "image/jpeg" });
      if (up.error) throw new Error(up.error.message);
      const ins = await db.from("query_letters").insert({ id, patient_id: p.id, file_path: path, original_name: name });
      if (ins.error) throw new Error(ins.error.message);
      const t0 = Date.now();
      await inngest.send({ id: `ql-${id}`, name: "query_letter/received", data: { queryLetterId: id } });
      return { c, id, t0 };
    }),
  );

  const results = await Promise.all(
    runs.map(async ({ c, id, t0 }) => {
      for (;;) {
        const { data: l } = await db.from("query_letters").select("status, review_reason").eq("id", id).single();
        if (l && TERMINAL.includes(l.status)) {
          const { data: points } = await db.from("query_points").select("point_no, decision, needed_doc_type, needs_review, point_text").eq("query_letter_id", id).order("point_no");
          const r: Result = { status: l.status, points: points ?? [], ms: Date.now() - t0, review_reason: l.review_reason };
          return { c, id, r, fail: c.expect(r) };
        }
        if (Date.now() - t0 > 240_000) return { c, id, r: { status: "TIMEOUT", points: [], ms: 240_000, review_reason: null }, fail: "timed out after 240s (is `npm run inngest` running?)" };
        await new Promise((res) => setTimeout(res, 700));
      }
    }),
  );

  await db.from("app_settings").update({ auto_send: original }).eq("id", true);
  for (const r of restoreContacts) await db.from("patients").update({ phone: r.phone, email: r.email }).eq("id", r.id);

  let failed = 0;
  for (const { c, r, fail, id } of results) {
    if (fail) failed++;
    const slow = r.ms > 20_000 ? "  ⚠ over 20s target" : "";
    console.log(`${fail ? "✗" : "✓"} ${c.name}\n    ${r.status} · ${r.points.length} points · ${(r.ms / 1000).toFixed(1)}s${slow}${fail ? `\n    FAIL: ${fail}` : ""}`);
    for (const p of r.points) console.log(`      ${p.point_no}. ${p.decision ?? "—"}${p.needs_review ? " (flagged)" : ""} [${p.needed_doc_type ?? "-"}] ${p.point_text.slice(0, 70)}`);
    if (r.review_reason) console.log(`    review: ${r.review_reason}`);
    console.log(`    view: ${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/queries/${id}\n`);
  }
  console.log(`${CASES.length - failed}/${CASES.length} passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
