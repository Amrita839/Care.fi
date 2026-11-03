"use client";
import { useTransition } from "react";
import Link from "next/link";
import { AlertCircle, Download, Eye, FileText, Image as ImageIcon, Inbox, Loader2, Mail, MessageCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { resendMessage } from "@/app/actions";
import { DocTypeChip, MessageStatusChip, StatusChip } from "@/components/chips";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DocumentRow, MessageRow, QueryEventRow, QueryLetterRow, QueryPointRow } from "@/lib/types";
import { cn, formatBytes, formatDate, formatINR } from "@/lib/utils";

// ---------------------------------------------------------------- documents
function DocumentsGrid({ docs, uploadButton }: { docs: DocumentRow[]; uploadButton: React.ReactNode }) {
  if (docs.length === 0)
    return <Card><EmptyState icon={<FileText />} title="The locker is empty" body="Upload the discharge summary, bills and reports. Each file is classified automatically." action={uploadButton} /></Card>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {docs.map((d) => {
        const x = d.extracted_json as { summary?: string; legible?: string; name_matches?: boolean | null };
        const isImg = d.mime_type?.startsWith("image/");
        return (
          <Card key={d.id} className="flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              {d.classification_status === "PENDING" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-200"><Loader2 className="h-3 w-3 animate-spin" />Classifying</span>
              ) : (
                <DocTypeChip type={d.doc_type} />
              )}
              {d.confidence != null && d.classification_status === "CLASSIFIED" && (
                <span className={cn("text-xs tabular-nums", d.confidence < 0.6 ? "font-medium text-orange-700" : "text-ink-muted")}>{Math.round(d.confidence * 100)}%</span>
              )}
            </div>
            <div className="mt-3 flex items-start gap-2.5">
              {isImg ? <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={d.original_name}>{d.original_name}</p>
                {x.summary && <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{x.summary}</p>}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-ink-muted">Date</dt><dd className="text-right">{formatDate(d.doc_date)}</dd>
              {d.hospital && (<><dt className="text-ink-muted">Hospital</dt><dd className="truncate text-right" title={d.hospital}>{d.hospital.split(",")[0]}</dd></>)}
              {d.amount != null && (<><dt className="text-ink-muted">Amount</dt><dd className="text-right tabular-nums">{formatINR(d.amount)}</dd></>)}
            </dl>
            {(x.legible === "partly" || x.legible === "no" || x.name_matches === false || d.classification_status === "FAILED") && (
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-orange-700">
                <AlertCircle className="h-3 w-3" />
                {d.classification_status === "FAILED" ? d.classification_error ?? "Could not classify" : x.name_matches === false ? "Name on document doesn't match patient" : "Partly illegible scan"}
              </p>
            )}
            <div className="mt-auto flex items-center justify-between pt-4 text-xs text-ink-muted">
              <span>{formatBytes(d.size_bytes)} · {formatDate(d.uploaded_at)}</span>
              <span className="flex gap-1">
                <a className="rounded p-1.5 hover:bg-canvas hover:text-primary" href={`/api/files/document/${d.id}`} target="_blank" rel="noreferrer" aria-label={`Preview ${d.original_name}`} title="Preview (link valid 60s)"><Eye className="h-4 w-4" /></a>
                <a className="rounded p-1.5 hover:bg-canvas hover:text-primary" href={`/api/files/document/${d.id}?download=1`} aria-label={`Download ${d.original_name}`} title="Download"><Download className="h-4 w-4" /></a>
              </span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- queries + timeline
const TIMELINE = [
  { key: "received_at", label: "Received" },
  { key: "read_at", label: "Read" },
  { key: "analysed_at", label: "Analysed" },
  { key: "sent_at", label: "Message sent" },
] as const;

function QueriesList({ letters, points, events }: { letters: QueryLetterRow[]; points: QueryPointRow[]; events: QueryEventRow[] }) {
  if (letters.length === 0) return <Card><EmptyState icon={<Inbox />} title="No query letters yet" body="When an insurer sends a query, upload it and the patient is messaged automatically." /></Card>;
  return (
    <div className="space-y-4">
      {letters.map((l) => {
        const failedStep = [...events].reverse().find((e) => e.query_letter_id === l.id && e.status === "FAILED");
        const n = points.filter((p) => p.query_letter_id === l.id).length;
        const firstMissing = TIMELINE.findIndex((t) => !l[t.key]);
        const stopped = !!failedStep && !["PROCESSING", "RECEIVED"].includes(l.status);
        return (
          <Card key={l.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{l.original_name ?? "Query letter"}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{l.claim_ref ? `Claim ${l.claim_ref} · ` : ""}{n} point{n === 1 ? "" : "s"}{l.pipeline_ms ? ` · ${(l.pipeline_ms / 1000).toFixed(1)}s` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip status={l.status} />
                <Link href={`/queries/${l.id}`} className="text-xs font-medium text-brand-purple hover:underline">Details</Link>
              </div>
            </div>
            <ol className="mt-5 grid grid-cols-4 gap-2">
              {TIMELINE.map((t, i) => {
                const at = l[t.key];
                const isFail = !at && stopped && i === firstMissing;
                return (
                  <li key={t.key} className="relative">
                    <div className={cn("h-1 rounded-full", at ? "bg-primary" : isFail ? "bg-orange-300" : "bg-slate-200")} />
                    <p className={cn("mt-2 text-xs font-medium", at ? "text-ink" : "text-ink-muted")}>{t.label}</p>
                    <p className="text-[11px] text-ink-muted">{at ? formatDate(at, true) : isFail ? "Stopped" : "—"}</p>
                  </li>
                );
              })}
            </ol>
            {failedStep && l.status !== "SENT" && <p className="mt-3 text-xs text-orange-700">Stopped at {failedStep.step.replace("_", " ").toLowerCase()}: {failedStep.detail}</p>}
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- messages
function MessageCard({ m }: { m: MessageRow }) {
  const [pending, start] = useTransition();
  const Icon = m.channel === "WHATSAPP" ? MessageCircle : Mail;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", m.channel === "WHATSAPP" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700")}><Icon className="h-4 w-4" /></span>
          <div>
            <p className="text-sm font-medium">{m.channel === "WHATSAPP" ? "WhatsApp" : "Email"} <span className="font-normal text-ink-muted">to {m.to_address ?? "—"}</span></p>
            <p className="text-xs text-ink-muted">
              {formatDate(m.sent_at ?? m.created_at, true)} · {m.kind === "AUTO" ? "automatic" : m.kind.toLowerCase()}{m.revision > 0 ? ` (r${m.revision})` : ""}{m.attempts > 1 ? ` · ${m.attempts} attempts` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MessageStatusChip status={m.status} />
          {m.provider_message_id?.startsWith("log-") && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-muted" title="WHATSAPP_PROVIDER / EMAIL_PROVIDER is set to log">Log only — not delivered</span>}
          {m.status !== "DRAFT" && (
            <Button
              size="sm"
              variant="secondary"
              loading={pending}
              onClick={() => start(async () => {
                const r = await resendMessage(m.id);
                if (r.ok) toast.success("Resend queued"); else toast.error(r.error);
              })}
            >
              <RotateCw />Resend
            </Button>
          )}
        </div>
      </div>
      {m.subject && <p className="mt-4 text-sm font-medium">{m.subject}</p>}
      <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-canvas p-4 font-sans text-sm leading-relaxed text-ink-soft">{m.body}</pre>
      {m.error && <p className="mt-2 text-xs text-rose-600">{m.error}</p>}
    </Card>
  );
}

function MessagesList({ messages }: { messages: MessageRow[] }) {
  if (messages.length === 0) return <Card><EmptyState icon={<MessageCircle />} title="No messages sent yet" body="Messages go out automatically on WhatsApp and email after a query letter is processed." /></Card>;
  const wa = messages.filter((m) => m.channel === "WHATSAPP");
  const em = messages.filter((m) => m.channel === "EMAIL");
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {[{ title: "WhatsApp", list: wa }, { title: "Email", list: em }].map((g) => (
        <section key={g.title} className="space-y-3">
          <h3 className="text-sm font-semibold text-ink-soft">{g.title} <span className="font-normal text-ink-muted">({g.list.length})</span></h3>
          {g.list.length === 0 ? <p className="text-sm text-ink-muted">None.</p> : g.list.map((m) => <MessageCard key={m.id} m={m} />)}
        </section>
      ))}
    </div>
  );
}

export function PatientTabs(props: {
  docs: DocumentRow[];
  letters: QueryLetterRow[];
  points: QueryPointRow[];
  events: QueryEventRow[];
  messages: MessageRow[];
  uploadDocButton: React.ReactNode;
}) {
  return (
    <Tabs defaultValue="documents">
      <TabsList>
        <TabsTrigger value="documents">Documents <span className="rounded-full bg-canvas px-1.5 text-xs">{props.docs.length}</span></TabsTrigger>
        <TabsTrigger value="queries">Queries <span className="rounded-full bg-canvas px-1.5 text-xs">{props.letters.length}</span></TabsTrigger>
        <TabsTrigger value="messages">Messages <span className="rounded-full bg-canvas px-1.5 text-xs">{props.messages.length}</span></TabsTrigger>
      </TabsList>
      <TabsContent value="documents"><DocumentsGrid docs={props.docs} uploadButton={props.uploadDocButton} /></TabsContent>
      <TabsContent value="queries"><QueriesList letters={props.letters} points={props.points} events={props.events} /></TabsContent>
      <TabsContent value="messages"><MessagesList messages={props.messages} /></TabsContent>
    </Tabs>
  );
}
