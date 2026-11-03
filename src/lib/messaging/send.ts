import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskEmail, maskPhone, type SendOutcome } from "@/lib/pipeline/logic";
import type { Channel, MessageKind } from "@/lib/types";
import { PermanentSendError, sendEmail, sendWhatsApp } from "@/lib/messaging/providers";

export interface ChannelSend {
  patientId: string;
  queryLetterId: string | null;
  channel: Channel;
  kind: MessageKind;
  revision: number;
  subject: string | null;
  body: string;
  createdBy?: string | null;
  /** true = store as DRAFT and do not contact the provider (auto-send OFF). */
  draftOnly?: boolean;
}

export const idempotencyKey = (queryLetterId: string | null, channel: Channel, revision: number, patientId: string) =>
  `${queryLetterId ?? `patient-${patientId}`}:${channel}:${revision}`;

/**
 * Idempotent single-channel send.
 * 1. Insert the message row keyed by idempotency_key (no-op if it exists).
 * 2. If that row is already SENT/DELIVERED, return SENT without calling the provider.
 * 3. Otherwise send, record provider id / error.
 * Throws on retryable failure (so the Inngest step retries with backoff);
 * returns FAILED on permanent failure (no point retrying).
 */
export async function sendOnChannel(input: ChannelSend): Promise<{ outcome: SendOutcome; messageId: string; error?: string }> {
  const db = createAdminClient();
  const key = idempotencyKey(input.queryLetterId, input.channel, input.revision, input.patientId);

  const { data: patient, error: pErr } = await db
    .from("patients")
    .select("phone, email")
    .eq("id", input.patientId)
    .single();
  if (pErr || !patient) throw new Error(`patient not found: ${pErr?.message}`);
  const to = input.channel === "WHATSAPP" ? patient.phone : patient.email;

  await db.from("messages").upsert(
    {
      patient_id: input.patientId,
      query_letter_id: input.queryLetterId,
      channel: input.channel,
      kind: input.kind,
      revision: input.revision,
      idempotency_key: key,
      status: input.draftOnly ? "DRAFT" : "QUEUED",
      to_address: input.channel === "WHATSAPP" ? maskPhone(patient.phone) : maskEmail(patient.email),
      subject: input.subject,
      body: input.body,
      created_by: input.createdBy ?? null,
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true },
  );
  const { data: row, error: rErr } = await db
    .from("messages")
    .select("id, status, attempts, body, subject")
    .eq("idempotency_key", key)
    .single();
  if (rErr || !row) throw new Error(`message row missing: ${rErr?.message}`);

  if (row.status === "SENT" || row.status === "DELIVERED") return { outcome: "SENT", messageId: row.id };
  if (input.draftOnly) return { outcome: "DRAFT", messageId: row.id };
  if (row.status === "SKIPPED") return { outcome: "SKIPPED", messageId: row.id };

  if (!to) {
    const error = input.channel === "WHATSAPP" ? "No phone number on file" : "No email on file";
    await db.from("messages").update({ status: "SKIPPED", error }).eq("id", row.id);
    return { outcome: "SKIPPED", messageId: row.id, error };
  }

  await db.from("messages").update({ status: "SENDING", attempts: (row.attempts ?? 0) + 1, error: null }).eq("id", row.id);
  try {
    const res =
      input.channel === "WHATSAPP"
        ? await sendWhatsApp({ toE164: to, body: row.body, messageId: row.id })
        : await sendEmail({ to, subject: row.subject ?? "Update on your claim", body: row.body, idempotencyKey: key });
    await db
      .from("messages")
      .update({ status: "SENT", provider_message_id: res.providerMessageId, sent_at: new Date().toISOString(), error: null })
      .eq("id", row.id);
    return { outcome: "SENT", messageId: row.id };
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 500) : "send failed";
    await db.from("messages").update({ status: "FAILED", error }).eq("id", row.id);
    if (e instanceof PermanentSendError) return { outcome: "FAILED", messageId: row.id, error };
    throw e; // retryable
  }
}
