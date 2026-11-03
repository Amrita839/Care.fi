/**
 * Zod schemas (validation) + hand-written JSON schemas (sent to the model as the
 * structured-output format). Kept side by side so they can't drift.
 * JSON schemas use only keywords structured outputs accept: type, properties,
 * required, enum, items, additionalProperties:false.
 */
import { z } from "zod";
import { DECISIONS, DOC_TYPES } from "@/lib/types";

const nullable = (type: string | string[]) => ({ type: [...([] as string[]).concat(type), "null"] });
const str = { type: "string" } as const;
const num = { type: "number" } as const;
const int = { type: "integer" } as const;
const bool = { type: "boolean" } as const;
const docTypeOrNull = { anyOf: [{ type: "string", enum: [...DOC_TYPES] }, { type: "null" }] };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .catch(null);
const confidence = z.coerce.number().min(0).max(1);
const shortText = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------- 1. read letter (OCR)
export const ReadLetterSchema = z.object({
  is_insurer_letter: z.boolean(),
  legible: z.boolean(),
  page_count: z.number().int().min(0).max(500),
  text: z.string().max(60_000),
});
export type ReadLetter = z.infer<typeof ReadLetterSchema>;
export const ReadLetterJson = obj({ is_insurer_letter: bool, legible: bool, page_count: int, text: str });

// ---------------------------------------------------------------- 2. extract points
export const ExtractedPointSchema = z.object({
  point_no: z.number().int().min(1),
  point_text: shortText(2000),
  insurer_ask: shortText(300),
  needed_doc_type: z.enum(DOC_TYPES).nullable(),
  reason: shortText(300),
});
export const ExtractSchema = z
  .object({
    claim_ref: z.string().trim().max(80).nullable(),
    insurer_name: z.string().trim().max(120).nullable(),
    points: z.array(ExtractedPointSchema).max(40),
  })
  .superRefine((v, ctx) => {
    const nos = v.points.map((p) => p.point_no);
    if (new Set(nos).size !== nos.length) ctx.addIssue({ code: "custom", message: "point_no values must be unique" });
    nos.forEach((n, i) => {
      if (n !== i + 1) ctx.addIssue({ code: "custom", message: "point_no must be 1..N in order" });
    });
  });
export type Extract = z.infer<typeof ExtractSchema>;
export const ExtractJson = obj({
  claim_ref: nullable("string"),
  insurer_name: nullable("string"),
  points: {
    type: "array",
    items: obj({ point_no: int, point_text: str, insurer_ask: str, needed_doc_type: docTypeOrNull, reason: str }),
  },
});

// ---------------------------------------------------------------- 3. match points to locker
export const MatchResultSchema = z.object({
  point_no: z.number().int().min(1),
  decision: z.enum(DECISIONS),
  matched_document_id: z.string().uuid().nullable(),
  reason: shortText(300),
  confidence,
  explicit_rerequest: z.boolean(),
  rerequest_quote: z.string().max(300).nullable(),
});
export const MatchSchema = z.object({ results: z.array(MatchResultSchema) });
export type Match = z.infer<typeof MatchSchema>;
export const MatchJson = obj({
  results: {
    type: "array",
    items: obj({
      point_no: int,
      decision: { type: "string", enum: [...DECISIONS] },
      matched_document_id: nullable("string"),
      reason: str,
      confidence: num,
      explicit_rerequest: bool,
      rerequest_quote: nullable("string"),
    }),
  },
});

/** Match output must cover exactly the extracted points — no merges, no inventions. */
export function matchCoversPoints(m: Match, pointNos: number[]): string | null {
  const got = m.results.map((r) => r.point_no).sort((a, b) => a - b);
  const want = [...pointNos].sort((a, b) => a - b);
  if (got.length !== want.length || got.some((n, i) => n !== want[i])) {
    return `results must contain exactly one entry for each point_no ${JSON.stringify(want)}; got ${JSON.stringify(got)}`;
  }
  return null;
}

// ---------------------------------------------------------------- document classification
export const ClassifySchema = z.object({
  doc_type: z.enum(DOC_TYPES),
  patient_name: z.string().trim().max(120).nullable(),
  doc_date: isoDate,
  hospital: z.string().trim().max(160).nullable(),
  amount: z.coerce.number().min(0).max(100_000_000).nullable().catch(null),
  confidence,
  legible: z.enum(["yes", "partly", "no"]),
  page_count: z.number().int().min(0).max(500).nullable(),
  summary: z.string().trim().max(200),
  key_facts: z
    .array(z.object({ key: z.string().trim().max(40), value: z.string().trim().max(160) }))
    .max(10),
});
export type Classify = z.infer<typeof ClassifySchema>;
export const ClassifyJson = obj({
  doc_type: { type: "string", enum: [...DOC_TYPES] },
  patient_name: nullable("string"),
  doc_date: nullable("string"),
  hospital: nullable("string"),
  amount: nullable("number"),
  confidence: num,
  legible: { type: "string", enum: ["yes", "partly", "no"] },
  page_count: nullable("integer"),
  summary: str,
  key_facts: { type: "array", items: obj({ key: str, value: str }) },
});
