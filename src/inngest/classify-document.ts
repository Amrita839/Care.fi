import { NonRetriableError } from "inngest";
import { inngest, EVENTS, type DocumentUploaded } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { BadFileError, downloadFile, toLlmContent } from "@/lib/files";
import { classifyDocument } from "@/lib/llm/tasks";
import { redactIds } from "@/lib/pipeline/logic";

const nameMatches = (a: string | null, b: string) => {
  if (!a) return null;
  const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length > 1));
  const x = tokens(a);
  const y = tokens(b);
  const overlap = [...x].filter((t) => y.has(t)).length;
  return overlap >= Math.min(2, y.size);
};

/** Classifies every uploaded document: type, date, hospital, amount, patient name, confidence. */
export const classifyUploadedDocument = inngest.createFunction(
  {
    id: "classify-document",
    name: "Classify uploaded document",
    triggers: [{ event: EVENTS.documentUploaded }],
    retries: 5, // free-tier rate limits: a few extra tries
    concurrency: [{ limit: Number(process.env.CLASSIFY_CONCURRENCY || 2) }],
    onFailure: async ({ event, error }) => {
      const id = (event.data.event.data as DocumentUploaded).documentId;
      await createAdminClient()
        .from("documents")
        .update({ classification_status: "FAILED", classification_error: error.message.slice(0, 300) })
        .eq("id", id);
    },
  },
  async ({ event, step }) => {
    const { documentId } = event.data as DocumentUploaded;
    if (!documentId) throw new NonRetriableError("missing documentId");

    return step.run("classify", async () => {
      const db = createAdminClient();
      const { data: doc } = await db
        .from("documents")
        .select("id, file_path, classification_status, patient_id, patients(full_name)")
        .eq("id", documentId)
        .single();
      if (!doc) throw new NonRetriableError("document not found");
      if (doc.classification_status === "CLASSIFIED") return { skipped: true };
      const patientName = (doc.patients as unknown as { full_name: string } | null)?.full_name ?? "";

      try {
        const file = await downloadFile(doc.file_path);
        const res = await classifyDocument(await toLlmContent(file.bytes, file.mime), patientName);
        if (!res.ok) {
          await db
            .from("documents")
            .update({ classification_status: "FAILED", classification_error: `Model output invalid twice: ${res.error}`.slice(0, 300), mime_type: file.mime, size_bytes: file.bytes.length })
            .eq("id", documentId);
          return { ok: false };
        }
        const c = res.data;
        const sensitive = c.doc_type === "KYC" || c.doc_type === "CANCELLED_CHEQUE";
        const extracted = {
          doc_type: c.doc_type,
          patient_name: c.patient_name,
          name_matches: nameMatches(c.patient_name, patientName),
          hospital: c.hospital,
          doc_date: c.doc_date,
          amount: c.amount,
          confidence: c.confidence,
          legible: c.legible,
          page_count: c.page_count,
          summary: redactIds(c.summary),
          key_facts: Object.fromEntries(c.key_facts.map((f) => [f.key, sensitive ? redactIds(f.value) : f.value])),
          model: res.model,
          classified_at: new Date().toISOString(),
        };
        await db
          .from("documents")
          .update({
            doc_type: c.doc_type,
            doc_date: c.doc_date,
            hospital: c.hospital,
            amount: c.amount,
            confidence: Math.round(c.confidence * 100) / 100,
            extracted_json: extracted,
            classification_status: "CLASSIFIED",
            classification_error: null,
            mime_type: file.mime,
            size_bytes: file.bytes.length,
          })
          .eq("id", documentId);
        return { ok: true, doc_type: c.doc_type, ms: res.ms };
      } catch (e) {
        if (e instanceof BadFileError) {
          await db.from("documents").update({ classification_status: "FAILED", classification_error: e.message }).eq("id", documentId);
          return { ok: false, bad: e.message };
        }
        throw e;
      }
    });
  },
);
