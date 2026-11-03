import { NonRetriableError } from "inngest";
import { inngest, EVENTS, type QueryLetterReceived } from "@/inngest/client";
import { setLetter, timed, track } from "@/inngest/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { BadFileError, downloadFile, toLlmContent } from "@/lib/files";
import { extractPoints, matchPoints, readLetter, type LockerSummary } from "@/lib/llm/tasks";
import { applyRules, composeMessages, finalStatus, type SendOutcome } from "@/lib/pipeline/logic";
import { sendOnChannel } from "@/lib/messaging/send";
import type { DocType, QueryStatus } from "@/lib/types";

type Stop = { stop: true; reason: string };
const stop = (reason: string): Stop => ({ stop: true, reason });
const isStop = (v: unknown): v is Stop => typeof v === "object" && v !== null && "stop" in v;

/**
 * Fully automatic: Received → Read → Extract → Match → Review gate → Compose → Send (WA ‖ Email) → Done.
 * Each step is a separate Inngest step: memoised (idempotent on replay), retried up to 3x with
 * exponential backoff, and it writes its status to query_letter_events.
 */
export const processQueryLetter = inngest.createFunction(
  {
    id: "process-query-letter",
    name: "Process insurer query letter",
    triggers: [{ event: EVENTS.queryLetterReceived }],
    retries: 3,
    // Same letter can never run twice in parallel; at most 10 letters at once overall.
    concurrency: [{ limit: Number(process.env.PIPELINE_CONCURRENCY || 3) }, { limit: 1, key: "event.data.queryLetterId" }],
    onFailure: async ({ event, error }) => {
      const id = (event.data.event.data as QueryLetterReceived).queryLetterId;
      await track(id, "DONE", "FAILED", { detail: `Pipeline failed: ${error.message}` });
      await setLetter(id, { status: "FAILED", last_error: error.message.slice(0, 500), processed_at: new Date().toISOString() });
    },
  },
  async ({ event, step, attempt }) => {
    const { queryLetterId: id } = event.data as QueryLetterReceived;
    if (!id) throw new NonRetriableError("missing queryLetterId");
    const db = createAdminClient();

    // ------------------------------------------------------------ start
    const start = await step.run("start", async () => {
      const { data: l, error } = await db.from("query_letters").select("id, status, received_at").eq("id", id).single();
      if (error || !l) throw new NonRetriableError(`letter ${id} not found`);
      if (["SENT", "RESOLVED"].includes(l.status)) return stop(`already ${l.status}`);
      await setLetter(id, { status: "PROCESSING", last_error: null, review_reason: null });
      return { startedAt: Date.now() };
    });
    if (isStop(start)) return start;

    const needsReview = async (stepName: string, reason: string) =>
      step.run(stepName, async () => {
        await track(id, "REVIEW_GATE", "FAILED", { detail: reason });
        await setLetter(id, {
          status: "NEEDS_REVIEW",
          review_reason: reason,
          current_step: "DONE",
          processed_at: new Date().toISOString(),
          pipeline_ms: Date.now() - start.startedAt,
        });
        return stop(reason);
      });

    // ------------------------------------------------------------ 1. read
    const read = await step.run("read", async () => {
      const { data: l } = await db.from("query_letters").select("file_path, raw_text").eq("id", id).single();
      if (l?.raw_text) return { pages: null, chars: l.raw_text.length }; // idempotent re-run
      await track(id, "READ", "STARTED", { attempt });
      try {
        const [res, ms] = await timed(async () => {
          const file = await downloadFile(l!.file_path);
          return readLetter(await toLlmContent(file.bytes, file.mime));
        });
        if (!res.ok) {
          await track(id, "READ", "FAILED", { detail: `Could not read letter: ${res.error}`, ms, attempt });
          return stop(`Letter could not be read (${res.error}).`);
        }
        const text = res.data.text.trim();
        if (!res.data.legible || text.replace(/\[illegible\]/g, "").trim().length < 20) {
          await track(id, "READ", "FAILED", { detail: "Letter is empty or illegible", ms, attempt });
          return stop("The letter is empty or unreadable. Please upload a clearer copy.");
        }
        await setLetter(id, { raw_text: text, page_count: res.data.page_count, read_at: new Date().toISOString() });
        await track(id, "READ", "SUCCEEDED", {
          detail: `${res.data.page_count} page(s) read${res.data.is_insurer_letter ? "" : " — may not be an insurer letter"}`,
          ms,
          attempt,
        });
        return { pages: res.data.page_count, chars: text.length };
      } catch (e) {
        if (e instanceof BadFileError) {
          await track(id, "READ", "FAILED", { detail: e.message, attempt });
          return stop(e.message);
        }
        await track(id, "READ", "FAILED", { detail: (e as Error).message, attempt });
        throw e; // transient → retry
      }
    });
    if (isStop(read)) return needsReview("review-unreadable", read.reason);

    // ------------------------------------------------------------ 2. extract points
    const extracted = await step.run("extract", async () => {
      await track(id, "EXTRACT", "STARTED", { attempt });
      const { data: l } = await db.from("query_letters").select("raw_text").eq("id", id).single();
      const [res, ms] = await timed(() => extractPoints(l!.raw_text!));
      if (!res.ok) {
        await track(id, "EXTRACT", "FAILED", { detail: `JSON invalid twice: ${res.error}`, ms, attempt });
        return stop("Could not reliably split the letter into points.");
      }
      const pts = res.data.points;
      if (pts.length === 0) {
        await track(id, "EXTRACT", "FAILED", { detail: "No requests found in the letter", ms, attempt });
        return stop("No requests were found in this letter.");
      }
      // Idempotent write: upsert by (letter, point_no), drop leftovers from an earlier run.
      const { error } = await db.from("query_points").upsert(
        pts.map((p) => ({
          query_letter_id: id,
          point_no: p.point_no,
          point_text: p.point_text,
          insurer_ask: p.insurer_ask,
          needed_doc_type: p.needed_doc_type,
          why_needed: p.reason,
          decision: null,
          matched_document_id: null,
          reason: null,
          confidence: null,
          needs_review: false,
        })),
        { onConflict: "query_letter_id,point_no" },
      );
      if (error) throw new Error(`save points: ${error.message}`);
      await db.from("query_points").delete().eq("query_letter_id", id).gt("point_no", pts.length);
      await setLetter(id, { claim_ref: res.data.claim_ref, insurer_name: res.data.insurer_name });
      await track(id, "EXTRACT", "SUCCEEDED", { detail: `${pts.length} point(s) found`, ms, attempt });
      return { count: pts.length };
    });
    if (isStop(extracted)) return needsReview("review-extract", extracted.reason);

    // Wait briefly (max ~15s) for documents still being classified, so matching sees them.
    for (let i = 0; i < 3; i++) {
      const pending = await step.run(`pending-docs-${i}`, async () => {
        const { data: l } = await db.from("query_letters").select("patient_id").eq("id", id).single();
        const { count } = await db
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("patient_id", l!.patient_id)
          .eq("classification_status", "PENDING");
        return count ?? 0;
      });
      if (pending === 0) break;
      await step.sleep(`wait-classification-${i}`, "5s");
    }

    // ------------------------------------------------------------ 3. match against locker
    const matched = await step.run("match", async () => {
      await track(id, "MATCH", "STARTED", { attempt });
      const { data: l } = await db.from("query_letters").select("patient_id").eq("id", id).single();
      const [{ data: patient }, { data: docs }, { data: points }] = await Promise.all([
        db.from("patients").select("full_name, insurer").eq("id", l!.patient_id).single(),
        db
          .from("documents")
          .select("id, doc_type, doc_date, hospital, amount, extracted_json, classification_status")
          .eq("patient_id", l!.patient_id),
        db.from("query_points").select("point_no, point_text, insurer_ask, needed_doc_type").eq("query_letter_id", id).order("point_no"),
      ]);
      // Only metadata goes to the model — never full document contents.
      const locker: LockerSummary[] = (docs ?? []).map((d) => {
        const x = (d.extracted_json ?? {}) as Record<string, unknown>;
        return {
          id: d.id,
          doc_type: d.doc_type,
          doc_date: d.doc_date,
          hospital: d.hospital,
          amount: d.amount,
          legible: d.classification_status === "CLASSIFIED" ? String(x.legible ?? "yes") : "unknown",
          summary: typeof x.summary === "string" ? x.summary : null,
          key_facts: x.key_facts ?? null,
        };
      });
      const [res, ms] = await timed(() => matchPoints(points ?? [], locker, patient!));
      if (!res.ok) {
        await db.from("query_points").update({ needs_review: true }).eq("query_letter_id", id);
        await track(id, "MATCH", "FAILED", { detail: `JSON invalid twice: ${res.error}`, ms, attempt });
        return stop("Could not reliably match the points to the locker.");
      }
      const byNo = new Map((points ?? []).map((p) => [p.point_no, p]));
      const guarded = applyRules(
        res.data.results.map((r) => ({
          point_no: r.point_no,
          point_text: byNo.get(r.point_no)!.point_text,
          needed_doc_type: byNo.get(r.point_no)!.needed_doc_type as DocType | null,
          decision: r.decision,
          matched_document_id: r.matched_document_id,
          reason: r.reason,
          confidence: r.confidence,
          rerequest_quote: r.explicit_rerequest ? r.rerequest_quote : null,
        })),
        (docs ?? []).map((d) => ({ id: d.id, doc_type: d.doc_type as DocType })),
      );
      for (const g of guarded) {
        const { error } = await db
          .from("query_points")
          .update({
            decision: g.decision,
            matched_document_id: g.matched_document_id,
            reason: g.reason.slice(0, 500),
            confidence: Math.round(g.confidence * 100) / 100,
            needs_review: g.needs_review,
            rerequest_quote: g.rerequest_quote ?? null,
          })
          .eq("query_letter_id", id)
          .eq("point_no", g.point_no);
        if (error) throw new Error(`save decision: ${error.message}`);
      }
      await setLetter(id, { analysed_at: new Date().toISOString() });
      const need = guarded.filter((g) => g.decision === "NEED_FROM_PATIENT" && !g.needs_review).length;
      const flagged = guarded.filter((g) => g.needs_review).length;
      await track(id, "MATCH", "SUCCEEDED", {
        detail: `${need} needed from patient, ${flagged} flagged${guarded.some((g) => g.guard_applied) ? " (locker rule applied)" : ""}`,
        ms,
        attempt,
      });
      return { need, flagged, total: guarded.length };
    });
    if (isStop(matched)) return needsReview("review-match", matched.reason);

    // ------------------------------------------------------------ 4+5. review gate + compose
    const composed = await step.run("compose", async () => {
      const { data: l } = await db.from("query_letters").select("patient_id, claim_ref, insurer_name").eq("id", id).single();
      const [{ data: patient }, { data: points }, { data: settings }] = await Promise.all([
        db.from("patients").select("full_name, patient_code, insurer").eq("id", l!.patient_id).single(),
        db.from("query_points").select("point_no, decision, needs_review, needed_doc_type, insurer_ask, why_needed").eq("query_letter_id", id),
        db.from("app_settings").select("auto_send").single(),
      ]);
      const msg = composeMessages({
        patient_name: patient!.full_name,
        patient_code: patient!.patient_code,
        insurer: patient!.insurer ?? l!.insurer_name,
        claim_ref: l!.claim_ref,
        points: (points ?? []) as Parameters<typeof composeMessages>[0]["points"],
      });
      const autoSend = settings?.auto_send ?? true;
      await track(id, "REVIEW_GATE", msg.flaggedCount > 0 ? "FAILED" : "SUCCEEDED", {
        detail: msg.flaggedCount > 0 ? `${msg.flaggedCount} point(s) flagged for review — sending confident points only` : "All points confident",
      });
      await track(id, "COMPOSE", "SUCCEEDED", {
        detail: msg.shouldSend ? `${msg.neededCount} item(s) requested${autoSend ? "" : " — auto-send OFF, saved as draft"}` : "Nothing needed from patient",
      });
      return { ...msg, patientId: l!.patient_id as string, autoSend };
    });

    // ------------------------------------------------------------ 6. send WhatsApp ‖ email
    let wa: SendOutcome = "SKIPPED";
    let em: SendOutcome = "SKIPPED";
    if (composed.shouldSend) {
      const sendStep = (channel: "WHATSAPP" | "EMAIL") =>
        step.run(`send-${channel.toLowerCase()}`, async () => {
          const trackStep = channel === "WHATSAPP" ? "SEND_WHATSAPP" : "SEND_EMAIL";
          await track(id, trackStep, "STARTED", { attempt });
          try {
            const [r, ms] = await timed(() =>
              sendOnChannel({
                patientId: composed.patientId,
                queryLetterId: id,
                channel,
                kind: "AUTO",
                revision: 0, // idempotency key = <letter>:<channel>:0 → never double-sent
                subject: channel === "EMAIL" ? composed.emailSubject : null,
                body: channel === "WHATSAPP" ? composed.whatsapp : composed.emailBody,
                draftOnly: !composed.autoSend,
              }),
            );
            await track(id, trackStep, r.outcome === "FAILED" ? "FAILED" : r.outcome === "SENT" ? "SUCCEEDED" : "SKIPPED", {
              detail: r.error ?? r.outcome.toLowerCase(),
              ms,
              attempt,
            });
            return r.outcome;
          } catch (e) {
            await track(id, trackStep, "FAILED", { detail: `${(e as Error).message} — will retry`, attempt });
            throw e;
          }
        });
      // allSettled: if one channel exhausts its retries, the other still goes out.
      const [w, e] = await Promise.allSettled([sendStep("WHATSAPP"), sendStep("EMAIL")]);
      wa = w.status === "fulfilled" ? w.value : "FAILED";
      em = e.status === "fulfilled" ? e.value : "FAILED";
    }

    // ------------------------------------------------------------ done
    return step.run("finalize", async () => {
      const status: QueryStatus = finalStatus({
        whatsapp: wa,
        email: em,
        flaggedCount: composed.flaggedCount,
        pointCount: matched.total,
      });
      const reason =
        wa === "DRAFT"
          ? "Auto-send is off — review and approve the drafted message."
          : composed.flaggedCount > 0
            ? `${composed.flaggedCount} point(s) need an agent's check (low confidence or unclear match).`
            : status === "PARTIALLY_SENT"
              ? `${wa === "FAILED" ? "WhatsApp" : "Email"} failed after retries.`
              : status === "FAILED"
                ? "Both channels failed after retries."
                : null;
      const now = new Date().toISOString();
      await setLetter(id, {
        status,
        review_reason: reason,
        current_step: "DONE",
        processed_at: now,
        needs_correction: false,
        ...(wa === "SENT" || em === "SENT" ? { sent_at: now } : {}),
        pipeline_ms: Date.now() - start.startedAt,
      });
      await track(id, "DONE", status === "FAILED" ? "FAILED" : "SUCCEEDED", {
        detail: `${status} in ${((Date.now() - start.startedAt) / 1000).toFixed(1)}s`,
      });
      return { status, whatsapp: wa, email: em };
    });
  },
);
