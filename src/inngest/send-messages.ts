import { NonRetriableError } from "inngest";
import { CORRECTION_PREFIX } from "@config/message-template";
import { inngest, EVENTS, type SendMessagesEvent } from "@/inngest/client";
import { setLetter, track } from "@/inngest/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { composeMessages, finalStatus, type SendOutcome } from "@/lib/pipeline/logic";
import { sendOnChannel } from "@/lib/messaging/send";
import type { Channel } from "@/lib/types";

/**
 * Agent-initiated sends (not part of the normal automatic flow):
 *  - CORRECTION      after an agent edits decisions → recompose from current points, new revision
 *  - RESEND          re-send one existing message body on its channel, new revision
 *  - APPROVE_DRAFTS  auto-send was OFF → send the drafted revision-0 messages
 */
export const sendLetterMessages = inngest.createFunction(
  {
    id: "send-letter-messages",
    name: "Send corrected / resent messages",
    triggers: [{ event: EVENTS.sendMessages }],
    retries: 3,
    concurrency: [{ limit: 1, key: "event.data.queryLetterId" }],
  },
  async ({ event, step }) => {
    const { queryLetterId: id, mode, actorId, messageId } = event.data as SendMessagesEvent;
    if (!id || !mode) throw new NonRetriableError("bad event");
    const db = createAdminClient();

    const plan = await step.run("plan", async () => {
      const { data: l } = await db.from("query_letters").select("patient_id, claim_ref, insurer_name").eq("id", id).single();
      if (!l) throw new NonRetriableError("letter not found");

      if (mode === "RESEND") {
        const { data: m } = await db.from("messages").select("channel, subject, body").eq("id", messageId!).eq("query_letter_id", id).single();
        if (!m) throw new NonRetriableError("message not found");
        const { data: rev } = await db.rpc("next_message_revision", { p_query_letter_id: id });
        return { patientId: l.patient_id, revision: rev as number, kind: "RESEND" as const, items: [{ channel: m.channel as Channel, subject: m.subject, body: m.body }], flagged: null as number | null, points: null as number | null };
      }
      if (mode === "APPROVE_DRAFTS") {
        const { data: drafts } = await db.from("messages").select("channel, subject, body").eq("query_letter_id", id).eq("revision", 0).eq("status", "DRAFT");
        return { patientId: l.patient_id, revision: 0, kind: "AUTO" as const, items: (drafts ?? []).map((d) => ({ channel: d.channel as Channel, subject: d.subject, body: d.body })), flagged: null, points: null };
      }
      // CORRECTION
      const [{ data: patient }, { data: points }] = await Promise.all([
        db.from("patients").select("full_name, patient_code, insurer").eq("id", l.patient_id).single(),
        db.from("query_points").select("point_no, decision, needs_review, needed_doc_type, insurer_ask, why_needed").eq("query_letter_id", id),
      ]);
      const msg = composeMessages({
        patient_name: patient!.full_name,
        patient_code: patient!.patient_code,
        insurer: patient!.insurer ?? l.insurer_name,
        claim_ref: l.claim_ref,
        points: (points ?? []) as Parameters<typeof composeMessages>[0]["points"],
      });
      const { data: rev } = await db.rpc("next_message_revision", { p_query_letter_id: id });
      return {
        patientId: l.patient_id,
        revision: rev as number,
        kind: "CORRECTION" as const,
        items: msg.neededCount > 0
          ? [
              { channel: "WHATSAPP" as Channel, subject: null, body: CORRECTION_PREFIX + msg.whatsapp },
              { channel: "EMAIL" as Channel, subject: msg.emailSubject, body: CORRECTION_PREFIX + msg.emailBody },
            ]
          : [],
        flagged: msg.flaggedCount,
        points: points?.length ?? 0,
      };
    });

    const outcomes = await Promise.allSettled(
      plan.items.map((it) =>
        step.run(`send-${it.channel.toLowerCase()}`, async () => {
          const r = await sendOnChannel({
            patientId: plan.patientId,
            queryLetterId: id,
            channel: it.channel,
            kind: plan.kind,
            revision: plan.revision,
            subject: it.subject,
            body: it.body,
            createdBy: actorId,
          });
          await track(id, it.channel === "WHATSAPP" ? "SEND_WHATSAPP" : "SEND_EMAIL", r.outcome === "SENT" ? "SUCCEEDED" : "FAILED", {
            detail: `${mode.toLowerCase()} r${plan.revision}: ${r.error ?? r.outcome.toLowerCase()}`,
          });
          return r.outcome;
        }),
      ),
    );

    return step.run("finalize", async () => {
      const get = (c: Channel): SendOutcome => {
        const i = plan.items.findIndex((x) => x.channel === c);
        if (i < 0) return "SKIPPED";
        const o = outcomes[i];
        return o.status === "fulfilled" ? (o.value as SendOutcome) : "FAILED";
      };
      const wa = get("WHATSAPP");
      const em = get("EMAIL");
      if (mode !== "RESEND") {
        const { data: pts } = await db.from("query_points").select("needs_review").eq("query_letter_id", id);
        const flagged = (pts ?? []).filter((p) => p.needs_review).length;
        const status = finalStatus({ whatsapp: wa, email: em, flaggedCount: flagged, pointCount: pts?.length ?? 0 });
        await setLetter(id, {
          status,
          needs_correction: false,
          review_reason: flagged > 0 ? `${flagged} point(s) still need an agent's check.` : null,
          ...(wa === "SENT" || em === "SENT" ? { sent_at: new Date().toISOString() } : {}),
        });
      }
      return { mode, whatsapp: wa, email: em, revision: plan.revision };
    });
  },
);
