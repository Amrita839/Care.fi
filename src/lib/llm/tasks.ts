import "server-only";
import type { LlmPart } from "@/lib/llm/types";
import { callJson } from "@/lib/llm/client";
import {
  ClassifyJson,
  ClassifySchema,
  ExtractJson,
  ExtractSchema,
  MatchJson,
  MatchSchema,
  ReadLetterJson,
  ReadLetterSchema,
  matchCoversPoints,
} from "@/lib/llm/schemas";
import { DOC_TYPES } from "@/lib/types";

type Blocks = LlmPart[];

const DOC_TYPE_GUIDE = `Document types:
- DISCHARGE_SUMMARY: hospital discharge summary / discharge card
- FINAL_BILL: final hospital bill, IP bill, bill break-up, invoice from the hospital
- INVESTIGATION_REPORT: lab tests, blood reports, X-ray, USG, CT, MRI, ECG, histopathology
- CONSULTATION_PAPER: OPD / doctor consultation notes, prescriptions, referral letters, ER notes
- PHARMACY_BILL: medicine / pharmacy bills
- POLICY_COPY: insurance policy document / schedule / e-card
- KYC: Aadhaar, PAN, voter ID, passport, driving licence
- CANCELLED_CHEQUE: cancelled cheque or bank passbook / NEFT details
- OTHER: anything else (indoor case papers, MLC/FIR, implant invoice, declarations, claim forms)`;

// ---------------------------------------------------------------- step 1: read the letter
export function readLetter(file: Blocks) {
  return callJson({
    system: `You transcribe insurance query letters for an Indian health-insurance claims team.
Transcribe ALL text of the attached letter faithfully, in reading order, page by page.
- Pages may be rotated or skewed scans; read them in their correct orientation.
- Keep numbering, bullets and line breaks. Do not summarise, correct, or add anything.
- If a part is unreadable write [illegible].
- is_insurer_letter=false if the file is clearly not a letter from an insurer/TPA.
- legible=false if most of the text cannot be read.`,
    content: [...file, { type: "text", text: "Transcribe this letter." }],
    zod: ReadLetterSchema,
    jsonSchema: ReadLetterJson,
    maxTokens: 16000,
  });
}

// ---------------------------------------------------------------- step 2: extract points
export function extractPoints(letterText: string) {
  return callJson({
    system: `You split an insurer's query letter into the separate things it asks for.

RULES
- Every distinct ask is its own point. If one sentence asks for two documents, make two points.
- NEVER merge two asks into one point. NEVER invent a point that is not in the letter.
- Ignore greetings, claim headers, deadlines, signatures and boilerplate - they are not points.
- point_no is 1..N in the order the asks appear.
- point_text: the insurer's words for that ask (verbatim or near-verbatim).
- insurer_ask: what is wanted, in simple English a patient understands (max ~12 words), e.g. "Hospital's daily treatment notes".
- needed_doc_type: the locker type that would answer it, or OTHER if none fits, or null if it is a question not a document.
- reason: one short line on WHY the insurer needs it, in simple English for the patient, e.g. "to check the treatment given each day".
- claim_ref: the claim / reference number if present, else null. insurer_name: the insurer or TPA name if present, else null.
- If the letter asks for nothing, return an empty points array.

${DOC_TYPE_GUIDE}`,
    content: [{ type: "text", text: `<letter>\n${letterText}\n</letter>` }],
    zod: ExtractSchema,
    jsonSchema: ExtractJson,
    maxTokens: 4000,
  });
}

// ---------------------------------------------------------------- step 3: match against the locker
export interface LockerSummary {
  id: string;
  doc_type: string;
  doc_date: string | null;
  hospital: string | null;
  amount: number | null;
  legible: string | null;
  summary: string | null;
  key_facts: unknown;
}

export function matchPoints(
  points: Array<{ point_no: number; point_text: string; insurer_ask: string; needed_doc_type: string | null }>,
  locker: LockerSummary[],
  patient: { full_name: string; insurer: string | null },
) {
  return callJson({
    system: `You decide, for each point an insurer asked about, whether the patient's document locker already answers it.

Decisions:
- HAVE: a document in the locker clearly answers the point. Set matched_document_id to that document's id.
- NEED_FROM_PATIENT: nothing in the locker answers it; the patient must send something new.
- HAVE_BUT_UNCLEAR: something related is in the locker but you are not sure it fully answers the point
  (e.g. one report on file but the insurer wants reports for every day; summary bill vs itemised bill unclear).

HARD RULE: never choose NEED_FROM_PATIENT for a document type that is already in the locker, UNLESS the
insurer explicitly says the existing one is illegible / unclear / incomplete / wrong / needs a fresh, clear,
original, signed or updated copy. When you rely on that exception set explicit_rerequest=true and put the
exact words from the point in rerequest_quote; otherwise explicit_rerequest=false and rerequest_quote=null.
If the locker has a document of that type but it does not satisfy a specific requirement in the point
(e.g. summary bill but insurer wants itemised), use HAVE_BUT_UNCLEAR.

Other rules
- Return exactly one result per point_no given. Do not merge, skip or add points.
- matched_document_id must be an id from the locker list, or null.
- reason: ONE short line a claims agent can read.
- confidence 0..1: how sure you are of the decision. Use < 0.6 when genuinely unsure.
- Use only the locker metadata given. A document marked legible "partly"/"no" may not answer a point.

Patient: ${patient.full_name}. Insurer on file: ${patient.insurer ?? "unknown"}.
Valid doc types: ${DOC_TYPES.join(", ")}.`,
    content: [
      {
        type: "text",
        text: `<locker>\n${JSON.stringify(locker)}\n</locker>\n\n<points>\n${JSON.stringify(points)}\n</points>`,
      },
    ],
    zod: MatchSchema,
    jsonSchema: MatchJson,
    maxTokens: 4000,
    check: (m) => matchCoversPoints(m, points.map((p) => p.point_no)),
  });
}

// ---------------------------------------------------------------- document classification
export function classifyDocument(file: Blocks, patientName: string) {
  return callJson({
    system: `You classify a single medical / insurance document uploaded to an Indian patient's claim locker.

${DOC_TYPE_GUIDE}

Return:
- doc_type, and confidence 0..1 for that type.
- patient_name exactly as printed (null if none). The expected patient is "${patientName}".
- doc_date as YYYY-MM-DD (bill date / report date / discharge date; null if none). Indian dates are DD-MM-YYYY.
- hospital name if printed, else null. amount = final payable total in rupees for bills, else null.
- legible: yes / partly / no. Pages may be rotated scans.
- page_count if you can tell.
- summary: ONE line describing the document type and purpose. No diagnosis details beyond a few words.
- key_facts: up to 8 short facts useful to answer insurer queries (bill_no, itemised yes/no, test name,
  admission/discharge dates, diagnosis in a few words, procedure, bank name, ID type).
  NEVER output full Aadhaar/PAN/account numbers - only the last 4 characters, e.g. "XXXX4821".`,
    content: [...file, { type: "text", text: "Classify this document." }],
    zod: ClassifySchema,
    jsonSchema: ClassifyJson,
    maxTokens: 1500,
  });
}
