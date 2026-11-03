/**
 * Pure, side-effect-free pipeline rules. Unit-tested in tests/unit/logic.test.ts.
 * Everything that decides WHAT gets sent lives here so it can be reasoned about and tested.
 */
import {
  EMAIL_SUBJECT,
  EMAIL_TEMPLATE,
  NEEDED_ITEM_LINE,
  NOTHING_NEEDED_TEMPLATE,
  NOTIFY_WHEN_NOTHING_NEEDED,
  REVIEW_NOTE,
  SIMPLE_DOC_NAMES,
  SUPPORT_LINE,
  WHATSAPP_TEMPLATE,
} from "@config/message-template";
import type { Decision, DocType, QueryStatus } from "@/lib/types";

export const CONFIDENCE_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// HARD RULE: never ask the patient for a document type already in the locker,
// unless the insurer explicitly says the existing one is illegible / incomplete /
// wrong / needs a fresh copy.
// ---------------------------------------------------------------------------
const RE_REQUEST =
  /\b(illegible|not\s+legible|unreadable|not\s+readable|not\s+clear|unclear|blurr?(ed|y)|faded|incomplete|missing\s+pages?|partial|wrong|incorrect|mismatch(ed)?|does\s+not\s+match|fresh|clear\s+cop(y|ies)|re-?submit|re-?send|resend|original|attested|self[-\s]?attested|latest|updated|duly\s+signed|not\s+signed|unsigned|without\s+(seal|stamp|signature)|expired)\b/i;

export function lettersExplicitlyReRequests(pointText: string, quote?: string | null): boolean {
  if (RE_REQUEST.test(pointText)) return true;
  // The model may cite a quote; trust it only if it really appears in the point text.
  if (quote && quote.trim().length >= 4 && pointText.toLowerCase().includes(quote.trim().toLowerCase())) {
    return RE_REQUEST.test(quote);
  }
  return false;
}

export interface LockerDoc {
  id: string;
  doc_type: DocType;
}

export interface MatchedPoint {
  point_no: number;
  point_text: string;
  needed_doc_type: DocType | null;
  decision: Decision;
  matched_document_id: string | null;
  reason: string;
  confidence: number;
  rerequest_quote?: string | null;
}

export interface GuardedPoint extends MatchedPoint {
  needs_review: boolean;
  guard_applied: boolean;
}

/** Enforce the hard rule + validate matched ids, then flag low-confidence points. */
export function applyRules(points: MatchedPoint[], docs: LockerDoc[]): GuardedPoint[] {
  const docIds = new Set(docs.map((d) => d.id));
  return points.map((p) => {
    let { decision, matched_document_id, reason, confidence } = p;
    let guard_applied = false;

    // Hallucinated document ids are dropped.
    if (matched_document_id && !docIds.has(matched_document_id)) {
      matched_document_id = null;
      confidence = Math.min(confidence, 0.5);
      reason = `${reason} (matched document not found in locker)`;
    }

    // HAVE without a document is not HAVE.
    if (decision === "HAVE" && !matched_document_id) {
      const sameType = p.needed_doc_type ? docs.find((d) => d.doc_type === p.needed_doc_type) : undefined;
      if (sameType) matched_document_id = sameType.id;
      else {
        decision = "HAVE_BUT_UNCLEAR";
        confidence = Math.min(confidence, 0.5);
      }
    }

    if (decision === "NEED_FROM_PATIENT" && p.needed_doc_type && p.needed_doc_type !== "OTHER") {
      const existing = docs.find((d) => d.doc_type === p.needed_doc_type);
      if (existing && !lettersExplicitlyReRequests(p.point_text, p.rerequest_quote)) {
        decision = "HAVE_BUT_UNCLEAR";
        matched_document_id = matched_document_id ?? existing.id;
        reason = `Locker already has a ${p.needed_doc_type.toLowerCase().replace(/_/g, " ")}; the insurer did not say it is unclear or wrong, so we are not asking the patient. ${reason}`;
        confidence = Math.min(confidence, 0.55);
        guard_applied = true;
      }
    }

    confidence = Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0));
    const needs_review = decision === "HAVE_BUT_UNCLEAR" || confidence < CONFIDENCE_THRESHOLD;
    return { ...p, decision, matched_document_id, reason, confidence, needs_review, guard_applied };
  });
}

// ---------------------------------------------------------------------------
// Message composition
// ---------------------------------------------------------------------------
export interface ComposeInput {
  patient_name: string;
  patient_code: string;
  insurer: string | null;
  claim_ref: string | null;
  points: Array<{
    point_no: number;
    decision: Decision | null;
    needs_review: boolean;
    needed_doc_type: DocType | null;
    insurer_ask: string;
    why_needed: string | null;
  }>;
}

export interface ComposedMessage {
  shouldSend: boolean;
  neededCount: number;
  flaggedCount: number;
  whatsapp: string;
  emailSubject: string;
  emailBody: string;
}

const clean = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Keep one-liners short and sentence-cased; never let model text balloon a message. */
const oneLine = (s: string, max = 110) => {
  const t = clean(s).replace(/[.;:,\s]+$/, "");
  const cut = t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
};

export function fill(template: string, vars: Record<string, string>): string {
  const lines = template.split("\n").filter((line) => {
    const keys = [...line.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    // Drop a line if it has placeholders and all of them are empty.
    return keys.length === 0 || keys.some((k) => (vars[k] ?? "").trim() !== "");
  });
  return lines
    .join("\n")
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function composeMessages(input: ComposeInput): ComposedMessage {
  // Only CONFIDENT points are used. Flagged points are never sent to the patient.
  const confident = input.points.filter((p) => !p.needs_review && p.decision);
  const flagged = input.points.filter((p) => p.needs_review);
  const needed = confident.filter((p) => p.decision === "NEED_FROM_PATIENT").sort((a, b) => a.point_no - b.point_no);
  const have = confident.filter((p) => p.decision === "HAVE");

  const neededLines = needed.map((p, i) =>
    fill(NEEDED_ITEM_LINE, {
      n: String(i + 1),
      item: oneLine(p.insurer_ask || SIMPLE_DOC_NAMES[p.needed_doc_type ?? "OTHER"]),
      why: oneLine(p.why_needed || "the insurer needs it to process your claim", 90).replace(/^./, (c) => c.toLowerCase()),
    }),
  );
  const haveNames = [
    ...new Set(have.map((p) => (SIMPLE_DOC_NAMES[p.needed_doc_type ?? "OTHER"] ?? "documents").toLowerCase())),
  ].filter((n) => n !== "document");

  const firstName = clean(input.patient_name).split(" ")[0] ?? input.patient_name;
  const vars: Record<string, string> = {
    patient_name: clean(input.patient_name),
    first_name: firstName,
    patient_code: input.patient_code,
    insurer: input.insurer?.trim() || "Your insurance company",
    claim_ref: input.claim_ref ? `your claim ${clean(input.claim_ref)}` : "your claim",
    needed_count: String(needed.length),
    needed_items: neededLines.join("\n"),
    have_items: haveNames.join(", "),
    review_note: flagged.length > 0 ? REVIEW_NOTE : "",
    support_line: SUPPORT_LINE,
  };

  if (needed.length === 0) {
    const body = fill(NOTHING_NEEDED_TEMPLATE, vars);
    return {
      shouldSend: NOTIFY_WHEN_NOTHING_NEEDED && flagged.length === 0,
      neededCount: 0,
      flaggedCount: flagged.length,
      whatsapp: body,
      emailSubject: fill(EMAIL_SUBJECT, vars),
      emailBody: body,
    };
  }
  return {
    shouldSend: true,
    neededCount: needed.length,
    flaggedCount: flagged.length,
    whatsapp: fill(WHATSAPP_TEMPLATE, vars),
    emailSubject: fill(EMAIL_SUBJECT, vars),
    emailBody: fill(EMAIL_TEMPLATE, vars),
  };
}

// ---------------------------------------------------------------------------
// Final status
// ---------------------------------------------------------------------------
export type SendOutcome = "SENT" | "FAILED" | "SKIPPED" | "DRAFT";

export function finalStatus(opts: {
  whatsapp: SendOutcome;
  email: SendOutcome;
  flaggedCount: number;
  pointCount: number;
}): QueryStatus {
  const { whatsapp, email, flaggedCount, pointCount } = opts;
  if (pointCount === 0) return "NEEDS_REVIEW";
  if (whatsapp === "DRAFT" || email === "DRAFT") return "NEEDS_REVIEW";
  const sent = [whatsapp, email].filter((s) => s === "SENT").length;
  const failed = [whatsapp, email].filter((s) => s === "FAILED").length;
  if (failed === 2) return "FAILED";
  if (failed === 1 && sent === 1) return flaggedCount > 0 ? "NEEDS_REVIEW" : "PARTIALLY_SENT";
  if (failed === 1) return "FAILED"; // one failed, other skipped (e.g. no email on file)
  if (flaggedCount > 0) return "NEEDS_REVIEW";
  if (sent === 0) return "RESOLVED"; // nothing needed from the patient
  return "SENT";
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------
/** Finds a patient ID like PL-100101 anywhere in a filename (case-insensitive, -/_/space tolerant). */
export function patientCodeFromFilename(name: string): string | null {
  const m = name.match(/PL[-_ ]?(\d{6})/i);
  return m ? `PL-${m[1]}` : null;
}

export const maskPhone = (p: string | null | undefined) => (p ? `${p.slice(0, 3)} ••••• •${p.slice(-3)}` : null);
export const maskEmail = (e: string | null | undefined) => {
  if (!e || !e.includes("@")) return null;
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}•••@${d}`;
};

/** Strip anything that looks like an ID number before storing model output (Aadhaar/PAN/account no.). */
export function redactIds(s: string): string {
  return s
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "XXXX XXXX XXXX") // Aadhaar
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "XXXXXXXXXX") // PAN
    .replace(/\b\d{9,18}\b/g, (m) => `${"X".repeat(m.length - 4)}${m.slice(-4)}`); // account numbers
}
