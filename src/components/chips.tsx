import { cn } from "@/lib/utils";
import { DOC_TYPE_LABEL, type Decision, type DocType, type MessageStatus, type QueryStatus } from "@/lib/types";

const base = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset";
const dot = "h-1.5 w-1.5 rounded-full bg-current opacity-80";

const STATUS: Record<QueryStatus, { label: string; cls: string }> = {
  RECEIVED: { label: "Received", cls: "bg-slate-50 text-slate-700 ring-slate-200" },
  PROCESSING: { label: "Processing", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  SENT: { label: "Sent", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  PARTIALLY_SENT: { label: "Partly sent", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  FAILED: { label: "Failed", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  NEEDS_REVIEW: { label: "Needs review", cls: "bg-orange-50 text-orange-700 ring-orange-200" },
  RESOLVED: { label: "Resolved", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
};

export function StatusChip({ status, className }: { status: QueryStatus | null; className?: string }) {
  if (!status) return <span className={cn(base, "bg-white text-ink-muted ring-line", className)}>No queries</span>;
  const s = STATUS[status];
  return (
    <span className={cn(base, s.cls, className)}>
      <span className={cn(dot, status === "PROCESSING" && "animate-pulse")} />
      {s.label}
    </span>
  );
}

const DECISION: Record<Decision, { label: string; cls: string }> = {
  HAVE: { label: "Have", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  NEED_FROM_PATIENT: { label: "Need from patient", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  HAVE_BUT_UNCLEAR: { label: "Have, unclear", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
};

export function DecisionChip({ decision }: { decision: Decision | null }) {
  if (!decision) return <span className={cn(base, "bg-slate-50 text-slate-600 ring-slate-200")}>Pending</span>;
  const d = DECISION[decision];
  return <span className={cn(base, d.cls)}>{d.label}</span>;
}

export function DocTypeChip({ type }: { type: DocType }) {
  return <span className={cn(base, "bg-primary-soft text-primary ring-indigo-100")}>{DOC_TYPE_LABEL[type]}</span>;
}

const MSG: Record<MessageStatus, string> = {
  DRAFT: "bg-slate-50 text-slate-700 ring-slate-200",
  QUEUED: "bg-slate-50 text-slate-700 ring-slate-200",
  SENDING: "bg-sky-50 text-sky-700 ring-sky-200",
  SENT: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  DELIVERED: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  FAILED: "bg-rose-50 text-rose-700 ring-rose-200",
  SKIPPED: "bg-slate-50 text-slate-500 ring-slate-200",
};
export function MessageStatusChip({ status }: { status: MessageStatus }) {
  return <span className={cn(base, MSG[status])}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

export function ConfidenceBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-ink-muted">—</span>;
  const pct = Math.round(value * 100);
  const color = value < 0.6 ? "bg-orange-400" : value < 0.8 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2" title={`${pct}% confidence`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-xs tabular-nums", value < 0.6 ? "font-medium text-orange-700" : "text-ink-muted")}>{pct}%</span>
    </div>
  );
}
