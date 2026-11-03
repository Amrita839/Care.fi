import "server-only";
import { isDemo } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import * as demo from "@/lib/demo";
import type {
  DocumentRow,
  MessageRow,
  PatientListRow,
  QueryEventRow,
  QueryLetterRow,
  QueryPointRow,
  QueryStatus,
} from "@/lib/types";

/** All reads go through the logged-in user's client, so RLS decides what is visible. */

const PATIENT_COLS = "id, patient_code, full_name, insurer, assigned_agent_id, phone_masked, email_masked, policy_masked, last_activity_at";
const DOC_COLS =
  "id, patient_id, doc_type, file_path, original_name, mime_type, size_bytes, extracted_json, doc_date, hospital, amount, confidence, classification_status, classification_error, uploaded_at";
const LETTER_COLS =
  "id, patient_id, file_path, original_name, status, current_step, last_error, review_reason, claim_ref, insurer_name, needs_correction, page_count, pipeline_ms, received_at, read_at, analysed_at, sent_at, processed_at, resolved_at";
const POINT_COLS =
  "id, query_letter_id, point_no, point_text, insurer_ask, why_needed, needed_doc_type, decision, matched_document_id, reason, confidence, needs_review, edited_by_agent, edited_at";
const MSG_COLS =
  "id, patient_id, query_letter_id, channel, kind, revision, status, to_address, subject, body, provider_message_id, attempts, error, created_at, sent_at, delivered_at";

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`);
  return res.data as T;
}

export async function listPatients(opts: { q?: string; status?: string }): Promise<PatientListRow[]> {
  const q = opts.q?.trim().toLowerCase();
  const status = opts.status && opts.status !== "ALL" ? opts.status : null;
  if (isDemo) {
    return demo
      .demoPatientList()
      .filter((p) => !q || p.full_name.toLowerCase().includes(q) || p.patient_code.toLowerCase().includes(q))
      .filter((p) => !status || (status === "NONE" ? !p.latest_query_status : p.latest_query_status === status))
      .sort((a, b) => a.sort_rank - b.sort_rank || b.last_activity_at.localeCompare(a.last_activity_at));
  }
  let query = createClient()
    .from("patient_overview")
    .select(`${PATIENT_COLS.replace(", policy_masked", "")}, latest_query_id, latest_query_status, latest_query_received_at, document_count, sort_rank`)
    .order("sort_rank")
    .order("last_activity_at", { ascending: false })
    .limit(500);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`full_name.ilike.%${safe}%,patient_code.ilike.%${safe}%`);
  }
  if (status === "NONE") query = query.is("latest_query_status", null);
  else if (status) query = query.eq("latest_query_status", status as QueryStatus);
  return unwrap(await query, "patients") as unknown as PatientListRow[];
}

export interface PatientBundle {
  patient: PatientListRow & { policy_masked: string | null };
  documents: DocumentRow[];
  letters: QueryLetterRow[];
  points: QueryPointRow[];
  messages: MessageRow[];
  events: QueryEventRow[];
}

export async function getPatientBundle(id: string): Promise<PatientBundle | null> {
  if (isDemo) {
    const patient = demo.demoPatientList().find((p) => p.id === id);
    if (!patient) return null;
    const letters = demo.demoLetters.filter((l) => l.patient_id === id).sort((a, b) => b.received_at.localeCompare(a.received_at));
    const ids = new Set(letters.map((l) => l.id));
    return {
      patient: { ...patient, policy_masked: patient.policy_masked ?? null },
      documents: demo.demoDocuments.filter((d) => d.patient_id === id).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)),
      letters,
      points: demo.demoPoints.filter((p) => ids.has(p.query_letter_id)),
      messages: demo.demoMessages.filter((m) => m.patient_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      events: demo.demoEvents.filter((e) => ids.has(e.query_letter_id)),
    };
  }
  const db = createClient();
  const p = await db.from("patient_overview").select("*").eq("id", id).maybeSingle();
  if (p.error) throw new Error(p.error.message);
  if (!p.data) return null;
  const pol = await db.from("patients").select("policy_masked").eq("id", id).single();
  const [documents, letters, messages] = await Promise.all([
    db.from("documents").select(DOC_COLS).eq("patient_id", id).order("uploaded_at", { ascending: false }),
    db.from("query_letters").select(LETTER_COLS).eq("patient_id", id).order("received_at", { ascending: false }),
    db.from("messages").select(MSG_COLS).eq("patient_id", id).order("created_at", { ascending: false }),
  ]);
  const letterRows = unwrap(letters, "query letters") as QueryLetterRow[];
  const ids = letterRows.map((l) => l.id);
  const [points, events] = ids.length
    ? await Promise.all([
        db.from("query_points").select(POINT_COLS).in("query_letter_id", ids).order("point_no"),
        db.from("query_letter_events").select("*").in("query_letter_id", ids).order("created_at"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  return {
    patient: { ...(p.data as PatientListRow), policy_masked: pol.data?.policy_masked ?? null },
    documents: unwrap(documents, "documents") as DocumentRow[],
    letters: letterRows,
    points: unwrap(points, "points") as QueryPointRow[],
    messages: unwrap(messages, "messages") as MessageRow[],
    events: unwrap(events, "events") as QueryEventRow[],
  };
}

export async function getLetterView(id: string) {
  if (isDemo) {
    const letter = demo.demoLetters.find((l) => l.id === id);
    if (!letter) return null;
    const patient = demo.demoPatientList().find((p) => p.id === letter.patient_id)!;
    return {
      letter,
      patient: { id: patient.id, patient_code: patient.patient_code, full_name: patient.full_name },
      events: demo.demoEvents.filter((e) => e.query_letter_id === id),
      points: demo.demoPoints.filter((p) => p.query_letter_id === id),
    };
  }
  const db = createClient();
  const l = await db.from("query_letters").select(LETTER_COLS).eq("id", id).maybeSingle();
  if (l.error) throw new Error(l.error.message);
  if (!l.data) return null;
  const [patient, events, points] = await Promise.all([
    db.from("patients").select("id, patient_code, full_name").eq("id", l.data.patient_id).single(),
    db.from("query_letter_events").select("*").eq("query_letter_id", id).order("created_at"),
    db.from("query_points").select(POINT_COLS).eq("query_letter_id", id).order("point_no"),
  ]);
  return {
    letter: l.data as QueryLetterRow,
    patient: unwrap(patient, "patient") as { id: string; patient_code: string; full_name: string },
    events: unwrap(events, "events") as QueryEventRow[],
    points: unwrap(points, "points") as QueryPointRow[],
  };
}

export async function getSettings(): Promise<{ auto_send: boolean; updated_at: string | null }> {
  if (isDemo) return { auto_send: true, updated_at: null };
  const r = await createClient().from("app_settings").select("auto_send, updated_at").single();
  return unwrap(r, "settings") as { auto_send: boolean; updated_at: string };
}

export async function listPatientPicker(): Promise<{ id: string; patient_code: string; full_name: string }[]> {
  if (isDemo) return demo.demoPatientList().map(({ id, patient_code, full_name }) => ({ id, patient_code, full_name }));
  const r = await createClient().from("patients").select("id, patient_code, full_name").order("patient_code").limit(2000);
  return unwrap(r, "patients") as { id: string; patient_code: string; full_name: string }[];
}

export async function listAudit(limit = 200) {
  if (isDemo) return [];
  const r = await createClient()
    .from("audit_log")
    .select("id, user_id, action, entity, entity_id, meta, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return unwrap(r, "audit log") as { id: number; user_id: string | null; action: string; entity: string; entity_id: string | null; meta: Record<string, unknown>; created_at: string }[];
}

export async function listStaff() {
  if (isDemo) return [demo.demoStaff];
  const r = await createClient().from("staff_users").select("id, full_name, email, role");
  return (r.data ?? []) as { id: string; full_name: string; email: string; role: string }[];
}
