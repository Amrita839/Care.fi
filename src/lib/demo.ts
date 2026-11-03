import "server-only";
/**
 * In-memory read-only dataset built from scripts/fixtures/seed-data.ts, used when
 * NEXT_PUBLIC_DEMO_MODE=1 so the UI can be reviewed without Supabase.
 */
import { LETTERS, PATIENTS, STAFF } from "../../scripts/fixtures/seed-data";
import { documentPath, queryLetterPath } from "../../scripts/fixtures/paths";
import { maskEmail, maskPhone } from "@/lib/pipeline/logic";
import type {
  DocumentRow,
  MessageRow,
  PatientListRow,
  QueryEventRow,
  QueryLetterRow,
  QueryPointRow,
  QueryStatus,
} from "@/lib/types";

const add = (iso: string, s: number) => new Date(new Date(iso).getTime() + s * 1000).toISOString();

export const demoStaff = { id: STAFF[0].id, email: STAFF[0].email, full_name: STAFF[0].full_name, role: "admin" as const };

export const demoDocuments: DocumentRow[] = PATIENTS.flatMap((p) =>
  p.docs.map((d) => ({
    id: d.id,
    patient_id: p.id,
    doc_type: d.type,
    file_path: documentPath(p.id, d.id, d.name),
    original_name: d.name,
    mime_type: d.name.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    size_bytes: 40_000 + d.body.join("").length * 50,
    extracted_json: { ...d.facts, summary: d.body[0], legible: d.facts.legible ?? "yes", patient_name: p.full_name },
    doc_date: d.date,
    hospital: d.hospital,
    amount: d.amount,
    confidence: d.confidence,
    classification_status: "CLASSIFIED" as const,
    classification_error: null,
    uploaded_at: add(`${d.date}T12:00:00+05:30`, 86400),
  })),
);

export const demoLetters: QueryLetterRow[] = LETTERS.map((l) => {
  const done = l.status !== "RECEIVED";
  return {
    id: l.id,
    patient_id: l.patient_id,
    file_path: queryLetterPath(l.patient_id, l.id, l.file_name),
    original_name: l.file_name,
    status: l.status as QueryStatus,
    current_step: done ? "DONE" : "RECEIVED",
    last_error: null,
    review_reason: l.points.some((p) => p.needs_review) ? "1 point below confidence threshold (0.6)" : null,
    claim_ref: l.lines[1]?.match(/(?:Claim (?:No|Ref)):\s*(\S+)/)?.[1] ?? null,
    insurer_name: null,
    needs_correction: false,
    page_count: done ? 1 : null,
    pipeline_ms: done ? 12_700 : null,
    received_at: l.received_at,
    read_at: done ? add(l.received_at, 4) : null,
    analysed_at: done ? add(l.received_at, 11) : null,
    sent_at: done ? add(l.received_at, 13) : null,
    processed_at: done ? add(l.received_at, 13) : null,
    resolved_at: null,
  };
});

export const demoPoints: QueryPointRow[] = LETTERS.flatMap((l, li) =>
  l.points.map((p) => ({
    id: `00000000-0000-4000-8000-5${String(li).padStart(5, "0")}${String(p.point_no).padStart(6, "0")}`,
    query_letter_id: l.id,
    point_no: p.point_no,
    point_text: p.point_text,
    insurer_ask: p.insurer_ask,
    why_needed: null,
    needed_doc_type: p.needed_doc_type,
    decision: p.decision,
    matched_document_id: p.matched_document_id,
    reason: p.reason,
    confidence: p.confidence,
    needs_review: !!p.needs_review,
    edited_by_agent: false,
    edited_at: null,
  })),
);

export const demoMessages: MessageRow[] = LETTERS.flatMap((l, li) => {
  const p = PATIENTS.find((x) => x.id === l.patient_id)!;
  return (l.messages ?? []).map((m, i) => ({
    id: `00000000-0000-4000-8000-6${String(li).padStart(5, "0")}${String(i).padStart(6, "0")}`,
    patient_id: p.id,
    query_letter_id: l.id,
    channel: m.channel,
    kind: "AUTO" as const,
    revision: 0,
    status: m.status,
    to_address: m.channel === "WHATSAPP" ? maskPhone(p.phone) : maskEmail(p.email),
    subject: m.subject ?? null,
    body: m.body,
    provider_message_id: m.channel === "WHATSAPP" ? "SMdemo" : "re_demo",
    attempts: 1,
    error: null,
    created_at: add(l.received_at, 12),
    sent_at: add(l.received_at, 13),
  }));
});

const STEPS = ["RECEIVED", "READ", "EXTRACT", "MATCH", "REVIEW_GATE", "COMPOSE", "SEND_WHATSAPP", "SEND_EMAIL", "DONE"] as const;
export const demoEvents: QueryEventRow[] = LETTERS.flatMap((l, li) => {
  const steps = l.status === "RECEIVED" ? STEPS.slice(0, 1) : STEPS;
  return steps.map((s, i) => ({
    id: li * 100 + i,
    query_letter_id: l.id,
    step: s,
    status: s === "REVIEW_GATE" && l.points.some((p) => p.needs_review) ? ("FAILED" as const) : ("SUCCEEDED" as const),
    attempt: 1,
    detail:
      s === "EXTRACT" ? `${l.points.length} point(s) found` : s === "READ" ? "1 page(s) read" : s === "DONE" ? `${l.status} in 12.7s` : null,
    duration_ms: [0, 4200, 3100, 3900, 5, 12, 850, 610, 0][i],
    created_at: add(l.received_at, [0, 4, 7, 11, 11, 11, 12, 12, 13][i]),
  }));
});

export function demoPatientList(): PatientListRow[] {
  return PATIENTS.map((p) => {
    const latest = demoLetters.filter((l) => l.patient_id === p.id).sort((a, b) => b.received_at.localeCompare(a.received_at))[0];
    const status = latest?.status ?? null;
    const docs = demoDocuments.filter((d) => d.patient_id === p.id);
    return {
      id: p.id,
      patient_code: p.code,
      full_name: p.full_name,
      insurer: p.insurer,
      assigned_agent_id: p.agent,
      phone_masked: maskPhone(p.phone),
      email_masked: maskEmail(p.email),
      policy_masked: `••••${p.policy_number.slice(-4)}`,
      last_activity_at: latest?.received_at ?? docs.map((d) => d.uploaded_at).sort().pop() ?? new Date().toISOString(),
      latest_query_id: latest?.id ?? null,
      latest_query_status: status,
      latest_query_received_at: latest?.received_at ?? null,
      document_count: docs.length,
      sort_rank: status === "NEEDS_REVIEW" ? 0 : status === "FAILED" || status === "PARTIALLY_SENT" ? 1 : status === "RECEIVED" || status === "PROCESSING" ? 2 : 3,
    };
  });
}

export const demoContact = (id: string) => {
  const p = PATIENTS.find((x) => x.id === id);
  return p ? { phone: p.phone, email: p.email, policy_number: p.policy_number } : null;
};
