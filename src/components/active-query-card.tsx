"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCheck, Pencil, RefreshCcw, Send, Activity } from "lucide-react";
import { toast } from "sonner";
import { approveDrafts, markResolved, reprocessLetter, sendCorrectedMessage, updatePointDecision } from "@/app/actions";
import { ConfidenceBar, DecisionChip, StatusChip } from "@/components/chips";
import { Button } from "@/components/ui/button";
import { Card, NativeSelect } from "@/components/ui/misc";
import { DOC_TYPE_LABEL, type Decision, type DocumentRow, type QueryLetterRow, type QueryPointRow } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const DECISION_OPTIONS: { value: Decision; label: string }[] = [
  { value: "HAVE", label: "Have" },
  { value: "NEED_FROM_PATIENT", label: "Need from patient" },
  { value: "HAVE_BUT_UNCLEAR", label: "Have, unclear" },
];

function PointRow({ point, docs, editable }: { point: QueryPointRow; docs: DocumentRow[]; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<Decision>(point.decision ?? "HAVE_BUT_UNCLEAR");
  const [docId, setDocId] = useState<string>(point.matched_document_id ?? "");
  const [pending, start] = useTransition();
  const matched = docs.find((d) => d.id === point.matched_document_id);

  const save = () =>
    start(async () => {
      const res = await updatePointDecision({ pointId: point.id, decision, matchedDocumentId: docId || null, reason: `Set by agent: ${DECISION_OPTIONS.find((o) => o.value === decision)?.label}` });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Point ${point.point_no} updated`);
      setEditing(false);
    });

  return (
    <tr className={cn("align-top", point.needs_review && "bg-orange-50/40")}>
      <td className="px-5 py-4">
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-ink-soft">{point.point_no}</span>
          <div className="min-w-0">
            <p className="font-medium">{point.insurer_ask}</p>
            <p className="mt-0.5 text-xs text-ink-muted">“{point.point_text}”</p>
            {point.needs_review && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-orange-700"><AlertTriangle className="h-3 w-3" />Not sent to patient — needs your check</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        {editing ? (
          <div className="flex min-w-44 flex-col gap-2">
            <NativeSelect value={decision} onChange={(e) => setDecision(e.target.value as Decision)} className="h-9" aria-label="Decision">
              {DECISION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
            {decision !== "NEED_FROM_PATIENT" && (
              <NativeSelect value={docId} onChange={(e) => setDocId(e.target.value)} className="h-9" aria-label="Matched document">
                <option value="">No document</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{DOC_TYPE_LABEL[d.doc_type]} · {d.original_name}</option>)}
              </NativeSelect>
            )}
            <div className="flex gap-1.5">
              <Button size="sm" onClick={save} loading={pending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <DecisionChip decision={point.decision} />
            {point.edited_by_agent && <span className="text-[11px] text-ink-muted" title={point.edited_at ? formatDate(point.edited_at, true) : ""}>edited</span>}
            {editable && (
              <button onClick={() => setEditing(true)} className="rounded p-1 text-ink-muted hover:bg-canvas hover:text-primary" aria-label={`Edit decision for point ${point.point_no}`}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </td>
      <td className="px-5 py-4">
        {matched ? (
          <a href={`/api/files/document/${matched.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {DOC_TYPE_LABEL[matched.doc_type]}
            <span className="block max-w-[14rem] truncate text-xs text-ink-muted">{matched.original_name}</span>
          </a>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
      <td className="max-w-xs px-5 py-4 text-ink-soft">{point.reason ?? "—"}</td>
      <td className="px-5 py-4"><ConfidenceBar value={point.confidence} /></td>
    </tr>
  );
}

export function ActiveQueryCard({ letter, points, docs, hasDrafts }: { letter: QueryLetterRow; points: QueryPointRow[]; docs: DocumentRow[]; hasDrafts: boolean }) {
  const [pending, start] = useTransition();
  const busy = letter.status === "PROCESSING" || letter.status === "RECEIVED";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Failed");
      else toast.success(msg);
    });

  const needCount = points.filter((p) => p.decision === "NEED_FROM_PATIENT" && !p.needs_review).length;
  const flagged = points.filter((p) => p.needs_review).length;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Active query</h2>
            <StatusChip status={letter.status} />
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-muted">
            {letter.claim_ref ? `Claim ${letter.claim_ref} · ` : ""}
            {letter.original_name} · received {formatDate(letter.received_at, true)}
            {letter.pipeline_ms ? ` · processed in ${(letter.pipeline_ms / 1000).toFixed(1)}s` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm"><Link href={`/queries/${letter.id}`}><Activity />Processing</Link></Button>
          <Button asChild variant="ghost" size="sm"><a href={`/api/files/query/${letter.id}`} target="_blank" rel="noreferrer">View letter</a></Button>
          {["NEEDS_REVIEW", "FAILED"].includes(letter.status) && (
            <Button variant="ghost" size="sm" onClick={() => run(() => reprocessLetter(letter.id), "Reprocessing started")} disabled={pending}><RefreshCcw />Re-run</Button>
          )}
          {!busy && letter.status !== "RESOLVED" && (
            <Button variant="ghost" size="sm" onClick={() => run(() => markResolved(letter.id), "Marked resolved")} disabled={pending}><CheckCheck />Resolve</Button>
          )}
        </div>
      </div>

      {(letter.review_reason || letter.last_error) && letter.status !== "SENT" && (
        <div className="flex items-start gap-2 border-b border-line bg-orange-50/60 px-5 py-3 text-sm text-orange-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{letter.review_reason ?? letter.last_error}</span>
        </div>
      )}

      {letter.needs_correction && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-primary-soft/60 px-5 py-3">
          <p className="text-sm text-ink-soft">You changed decisions after the patient was messaged. Send them the corrected list?</p>
          <Button size="sm" onClick={() => run(() => sendCorrectedMessage(letter.id), "Corrected message queued")} loading={pending}><Send />Send corrected message</Button>
        </div>
      )}
      {hasDrafts && !letter.needs_correction && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-primary-soft/60 px-5 py-3">
          <p className="text-sm text-ink-soft">Auto-send is off. The message is drafted — check it in the Messages tab.</p>
          <Button size="sm" onClick={() => run(() => approveDrafts(letter.id), "Sending drafted messages")} loading={pending}><Send />Approve & send</Button>
        </div>
      )}

      {busy && points.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-ink-muted">
          Reading the letter and checking the locker… <Link className="text-primary hover:underline" href={`/queries/${letter.id}`}>Watch live</Link>
        </div>
      ) : points.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-ink-muted">No points were extracted from this letter.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-canvas/60 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="min-w-[300px] px-5 py-2.5">Point</th>
                  <th className="px-5 py-2.5">Decision</th>
                  <th className="px-5 py-2.5">Matched document</th>
                  <th className="min-w-[220px] px-5 py-2.5">Reason</th>
                  <th className="px-5 py-2.5">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {points.map((p) => <PointRow key={`${p.id}-${p.decision}-${p.matched_document_id}`} point={p} docs={docs} editable={!busy} />)}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-xs text-ink-muted">
            <span>{points.length} points</span>
            <span>{needCount} asked from patient</span>
            <span>{points.filter((p) => p.decision === "HAVE").length} answered from locker</span>
            {flagged > 0 && <span className="font-medium text-orange-700">{flagged} flagged for review</span>}
          </div>
        </>
      )}
    </Card>
  );
}
