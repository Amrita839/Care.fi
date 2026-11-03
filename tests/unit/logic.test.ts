import { describe, expect, it } from "vitest";
import {
  applyRules,
  composeMessages,
  fill,
  finalStatus,
  lettersExplicitlyReRequests,
  patientCodeFromFilename,
  redactIds,
  type MatchedPoint,
} from "@/lib/pipeline/logic";
import { ExtractSchema, MatchSchema, matchCoversPoints, ClassifySchema } from "@/lib/llm/schemas";

const DOCS = [
  { id: "11111111-1111-4111-8111-111111111111", doc_type: "FINAL_BILL" as const },
  { id: "22222222-2222-4222-8222-222222222222", doc_type: "PHARMACY_BILL" as const },
  { id: "33333333-3333-4333-8333-333333333333", doc_type: "KYC" as const },
];
const pt = (o: Partial<MatchedPoint>): MatchedPoint => ({
  point_no: 1,
  point_text: "Please submit the final bill.",
  needed_doc_type: "FINAL_BILL",
  decision: "HAVE",
  matched_document_id: DOCS[0].id,
  reason: "Bill on file",
  confidence: 0.9,
  ...o,
});

describe("hard rule: never re-ask for a document type already in the locker", () => {
  it("overrides NEED_FROM_PATIENT when the type exists and the insurer did not say it is bad", () => {
    const [g] = applyRules([pt({ decision: "NEED_FROM_PATIENT", matched_document_id: null, point_text: "Submit pharmacy bills." , needed_doc_type: "PHARMACY_BILL" })], DOCS);
    expect(g.decision).toBe("HAVE_BUT_UNCLEAR");
    expect(g.matched_document_id).toBe(DOCS[1].id);
    expect(g.needs_review).toBe(true);
    expect(g.guard_applied).toBe(true);
  });
  it.each([
    "Pharmacy bills submitted are illegible. Please submit clear copies.",
    "The bill is incomplete; submit a fresh copy.",
    "Kindly provide original pharmacy bills.",
    "Bills are not signed by the pharmacist.",
  ])("allows NEED_FROM_PATIENT when the insurer explicitly re-requests: %s", (text) => {
    const [g] = applyRules([pt({ decision: "NEED_FROM_PATIENT", point_text: text, needed_doc_type: "PHARMACY_BILL" })], DOCS);
    expect(g.decision).toBe("NEED_FROM_PATIENT");
    expect(g.guard_applied).toBe(false);
  });
  it("NEED_FROM_PATIENT for a type NOT in the locker is kept", () => {
    const [g] = applyRules([pt({ decision: "NEED_FROM_PATIENT", matched_document_id: null, needed_doc_type: "CANCELLED_CHEQUE", point_text: "Cancelled cheque." })], DOCS);
    expect(g.decision).toBe("NEED_FROM_PATIENT");
    expect(g.needs_review).toBe(false);
  });
  it("ignores a model quote that is not really in the letter", () => {
    expect(lettersExplicitlyReRequests("Submit pharmacy bills.", "bills are illegible")).toBe(false);
  });
});

describe("validation of model output", () => {
  it("drops hallucinated document ids", () => {
    const [g] = applyRules([pt({ matched_document_id: "99999999-9999-4999-8999-999999999999" })], DOCS);
    expect(g.matched_document_id).toBe(DOCS[0].id); // re-pointed to the real bill of that type
    expect(g.confidence).toBeLessThanOrEqual(0.5);
    expect(g.needs_review).toBe(true);
  });
  it("flags confidence below 0.6", () => {
    const [g] = applyRules([pt({ confidence: 0.55 })], DOCS);
    expect(g.needs_review).toBe(true);
  });
  it("extract schema rejects merged / out-of-order numbering", () => {
    const bad = { claim_ref: null, insurer_name: null, points: [1, 3].map((n) => ({ point_no: n, point_text: "x", insurer_ask: "y", needed_doc_type: null, reason: "z" })) };
    expect(ExtractSchema.safeParse(bad).success).toBe(false);
  });
  it("match must cover exactly the extracted points", () => {
    const m = MatchSchema.parse({ results: [{ point_no: 1, decision: "HAVE", matched_document_id: null, reason: "r", confidence: 0.9, explicit_rerequest: false, rerequest_quote: null }] });
    expect(matchCoversPoints(m, [1, 2])).toMatch(/exactly one entry/);
    expect(matchCoversPoints(m, [1])).toBeNull();
  });
  it("classify schema coerces bad dates to null", () => {
    const r = ClassifySchema.parse({ doc_type: "FINAL_BILL", patient_name: null, doc_date: "18/09/2026", hospital: null, amount: 100, confidence: 0.9, legible: "yes", page_count: 1, summary: "Bill", key_facts: [] });
    expect(r.doc_date).toBeNull();
  });
});

describe("message composition", () => {
  const base = {
    patient_name: "Rajesh Kumar Verma",
    patient_code: "PL-100101",
    insurer: "Star Health",
    claim_ref: "CLM2609-55102",
  };
  it("lists only confident NEED items, with a why, and never flagged points", () => {
    const m = composeMessages({
      ...base,
      points: [
        { point_no: 1, decision: "NEED_FROM_PATIENT", needs_review: false, needed_doc_type: "OTHER", insurer_ask: "Hospital's daily treatment notes", why_needed: "To check the treatment given each day" },
        { point_no: 2, decision: "HAVE", needs_review: false, needed_doc_type: "FINAL_BILL", insurer_ask: "Itemised bill", why_needed: "x" },
        { point_no: 3, decision: "NEED_FROM_PATIENT", needs_review: true, needed_doc_type: "KYC", insurer_ask: "SECRET FLAGGED ASK", why_needed: "x" },
      ],
    });
    expect(m.shouldSend).toBe(true);
    expect(m.neededCount).toBe(1);
    expect(m.whatsapp).toContain("1. Hospital's daily treatment notes — to check the treatment given each day");
    expect(m.whatsapp).not.toContain("SECRET FLAGGED ASK");
    expect(m.whatsapp).toContain("Our team is checking");
    expect(m.whatsapp).toContain("final hospital bill");
    expect(m.emailSubject).toBe("Documents needed for your claim (PL-100101)");
    expect(m.whatsapp).not.toMatch(/\{\{/);
  });
  it("does not send when nothing is needed (default config)", () => {
    const m = composeMessages({ ...base, points: [{ point_no: 1, decision: "HAVE", needs_review: false, needed_doc_type: "FINAL_BILL", insurer_ask: "Bill", why_needed: null }] });
    expect(m.shouldSend).toBe(false);
  });
  it("fill() drops lines whose placeholders are all empty", () => {
    expect(fill("a\nWe have: {{x}}.\nb", { x: "" })).toBe("a\nb");
  });
});

describe("final status", () => {
  it.each([
    [{ whatsapp: "SENT", email: "SENT", flaggedCount: 0, pointCount: 3 }, "SENT"],
    [{ whatsapp: "SENT", email: "FAILED", flaggedCount: 0, pointCount: 3 }, "PARTIALLY_SENT"],
    [{ whatsapp: "FAILED", email: "FAILED", flaggedCount: 0, pointCount: 3 }, "FAILED"],
    [{ whatsapp: "SENT", email: "SENT", flaggedCount: 1, pointCount: 3 }, "NEEDS_REVIEW"],
    [{ whatsapp: "DRAFT", email: "DRAFT", flaggedCount: 0, pointCount: 3 }, "NEEDS_REVIEW"],
    [{ whatsapp: "SKIPPED", email: "SKIPPED", flaggedCount: 0, pointCount: 2 }, "RESOLVED"],
    [{ whatsapp: "SKIPPED", email: "SKIPPED", flaggedCount: 0, pointCount: 0 }, "NEEDS_REVIEW"],
  ] as const)("%o → %s", (input, expected) => {
    expect(finalStatus(input)).toBe(expected);
  });
});

describe("helpers", () => {
  it.each([
    ["PL-100101_query.pdf", "PL-100101"],
    ["starhealth pl_100102 letter.pdf", "PL-100102"],
    ["PL100103.jpg", "PL-100103"],
    ["random.pdf", null],
  ])("patientCodeFromFilename(%s)", (name, code) => expect(patientCodeFromFilename(name)).toBe(code));
  it("redacts Aadhaar / PAN / account numbers", () => {
    expect(redactIds("Aadhaar 1234 5678 9012 PAN ABCDE1234F a/c 50100223344556")).toBe("Aadhaar XXXX XXXX XXXX PAN XXXXXXXXXX a/c XXXXXXXXXX4556");
  });
});
