"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inngest, EVENTS } from "@/inngest/client";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { isDemo } from "@/lib/env";
import { ACCEPTED_MIME, MAX_FILE_BYTES } from "@/lib/files-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DECISIONS } from "@/lib/types";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const DEMO: ActionResult<never> = { ok: false, error: "Demo mode: changes are disabled. Connect Supabase to use this." };
const fail = (e: unknown): ActionResult<never> => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
const uuid = z.string().uuid();

/** Throws unless the caller can see this patient under RLS. */
async function assertPatientAccess(patientId: string) {
  const { data, error } = await createClient().from("patients").select("id").eq("id", patientId).maybeSingle();
  if (error || !data) throw new Error("Patient not found or not assigned to you.");
}
async function letterPatient(letterId: string): Promise<string> {
  const { data } = await createClient().from("query_letters").select("patient_id").eq("id", letterId).maybeSingle();
  if (!data) throw new Error("Query letter not found or not accessible.");
  return data.patient_id;
}
const audit = (action: string, entity: string, entityId: string, meta: Record<string, unknown> = {}) =>
  createClient().rpc("log_audit", { p_action: action, p_entity: entity, p_entity_id: entityId, p_meta: meta });

// ---------------------------------------------------------------- reveal
export async function revealContact(patientId: string): Promise<ActionResult<{ phone: string | null; email: string | null; policy_number: string | null }>> {
  try {
    await requireStaff();
    uuid.parse(patientId);
    if (isDemo) {
      const { demoContact } = await import("@/lib/demo");
      return { ok: true, data: demoContact(patientId) ?? { phone: null, email: null, policy_number: null } };
    }
    const { data, error } = await createClient().rpc("reveal_patient_contact", { p_patient_id: patientId }).single();
    if (error) throw new Error(error.message);
    return { ok: true, data: data as { phone: string | null; email: string | null; policy_number: string | null } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- uploads (file already in storage via the browser)
const RegisterUpload = z.object({
  patientId: uuid,
  kind: z.enum(["document", "query"]),
  path: z.string().min(10).max(400),
  originalName: z.string().min(1).max(255),
  mime: z.string().refine((m) => ACCEPTED_MIME.includes(m), "Unsupported file type"),
  size: z.number().int().positive().max(MAX_FILE_BYTES, "File is larger than 25 MB"),
});

export async function registerUpload(input: z.infer<typeof RegisterUpload>): Promise<ActionResult<{ id: string }>> {
  if (isDemo) return DEMO;
  try {
    const staff = await requireStaff();
    const v = RegisterUpload.parse(input);
    const folder = v.kind === "document" ? "documents" : "queries";
    if (!v.path.startsWith(`${v.patientId}/${folder}/`) || v.path.includes("..")) throw new Error("Invalid upload path");
    await assertPatientAccess(v.patientId);
    const db = createClient();

    if (v.kind === "document") {
      const { data, error } = await db
        .from("documents")
        .insert({ patient_id: v.patientId, file_path: v.path, original_name: v.originalName, mime_type: v.mime, size_bytes: v.size, uploaded_by: staff.id })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await inngest.send({ id: `doc-${data.id}`, name: EVENTS.documentUploaded, data: { documentId: data.id } });
      await audit("UPLOAD_DOCUMENT", "documents", data.id, { name: v.originalName });
      revalidatePath(`/patients/${v.patientId}`);
      return { ok: true, data: { id: data.id } };
    }
    const { data, error } = await db
      .from("query_letters")
      .insert({ patient_id: v.patientId, file_path: v.path, original_name: v.originalName, uploaded_by: staff.id })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // Event id = letter id → Inngest de-duplicates, so a double click never runs the pipeline twice.
    await inngest.send({ id: `ql-${data.id}`, name: EVENTS.queryLetterReceived, data: { queryLetterId: data.id } });
    await audit("UPLOAD_QUERY_LETTER", "query_letters", data.id, { name: v.originalName });
    revalidatePath(`/patients/${v.patientId}`);
    revalidatePath("/patients");
    return { ok: true, data: { id: data.id } };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- agent edits a decision
const EditPoint = z.object({
  pointId: uuid,
  decision: z.enum(DECISIONS),
  matchedDocumentId: uuid.nullable(),
  reason: z.string().trim().max(500).optional(),
});
export async function updatePointDecision(input: z.infer<typeof EditPoint>): Promise<ActionResult> {
  if (isDemo) return DEMO;
  try {
    await requireStaff();
    const v = EditPoint.parse(input);
    const db = createClient();
    // The DB trigger stamps edited_by_agent and writes EDIT_DECISION to the audit log.
    const { data, error } = await db
      .from("query_points")
      .update({
        decision: v.decision,
        matched_document_id: v.decision === "NEED_FROM_PATIENT" ? null : v.matchedDocumentId,
        ...(v.reason ? { reason: v.reason } : {}),
      })
      .eq("id", v.pointId)
      .select("query_letter_id")
      .single();
    if (error) throw new Error(error.message);
    const patientId = await letterPatient(data.query_letter_id);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- sends (agent-initiated, not the normal flow)
async function queueSend(letterId: string, mode: "CORRECTION" | "RESEND" | "APPROVE_DRAFTS", messageId?: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  try {
    const staff = await requireStaff();
    uuid.parse(letterId);
    const patientId = await letterPatient(letterId);
    await audit(mode === "RESEND" ? "RESEND_MESSAGE" : mode === "CORRECTION" ? "SEND_CORRECTION" : "APPROVE_DRAFTS", mode === "RESEND" ? "messages" : "query_letters", messageId ?? letterId);
    await inngest.send({ name: EVENTS.sendMessages, data: { queryLetterId: letterId, mode, actorId: staff.id, messageId } });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
export const sendCorrectedMessage = async (letterId: string) => queueSend(letterId, "CORRECTION");
export const approveDrafts = async (letterId: string) => queueSend(letterId, "APPROVE_DRAFTS");
export async function resendMessage(messageId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  try {
    uuid.parse(messageId);
    const { data } = await createClient().from("messages").select("query_letter_id").eq("id", messageId).maybeSingle();
    if (!data?.query_letter_id) throw new Error("Message not found");
    return queueSend(data.query_letter_id, "RESEND", messageId);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- letter lifecycle
export async function reprocessLetter(letterId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  try {
    await requireStaff();
    const patientId = await letterPatient(letterId);
    // Clear the cached OCR only if the letter was unreadable; otherwise re-use it.
    await createAdminClient()
      .from("query_letters")
      .update({ status: "RECEIVED", current_step: "RECEIVED", last_error: null, review_reason: null })
      .eq("id", letterId);
    await audit("REPROCESS_LETTER", "query_letters", letterId);
    await inngest.send({ id: `ql-${letterId}-${Date.now()}`, name: EVENTS.queryLetterReceived, data: { queryLetterId: letterId } });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function markResolved(letterId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  try {
    await requireStaff();
    const patientId = await letterPatient(letterId);
    const { error } = await createClient().from("query_letters").update({ status: "RESOLVED", resolved_at: new Date().toISOString() }).eq("id", letterId);
    if (error) throw new Error(error.message);
    await audit("RESOLVE_LETTER", "query_letters", letterId);
    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/patients");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- settings
export async function setAutoSend(on: boolean): Promise<ActionResult> {
  if (isDemo) return DEMO;
  try {
    const admin = await requireAdmin();
    const { error } = await createClient()
      .from("app_settings")
      .update({ auto_send: on, updated_by: admin.id, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) throw new Error(error.message);
    await audit("SET_AUTO_SEND", "app_settings", "1", { auto_send: on });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
