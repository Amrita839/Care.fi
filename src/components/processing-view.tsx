"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import { StatusChip } from "@/components/chips";
import { Card } from "@/components/ui/misc";
import { createClient } from "@/lib/supabase/client";
import type { PipelineStep, QueryEventRow, QueryStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS: { step: PipelineStep; label: string; hint: string }[] = [
  { step: "RECEIVED", label: "Received", hint: "Letter saved to the locker" },
  { step: "READ", label: "Read letter", hint: "OCR of every page" },
  { step: "EXTRACT", label: "Find each point", hint: "Every separate ask becomes a point" },
  { step: "MATCH", label: "Check the locker", hint: "Have / need from patient / unclear" },
  { step: "REVIEW_GATE", label: "Confidence check", hint: "Low-confidence points are held back" },
  { step: "COMPOSE", label: "Write message", hint: "Fills the message template" },
  { step: "SEND_WHATSAPP", label: "Send WhatsApp", hint: "Retried up to 3 times" },
  { step: "SEND_EMAIL", label: "Send email", hint: "Retried up to 3 times" },
  { step: "DONE", label: "Done", hint: "" },
];

export function ProcessingView({ letterId, initialEvents, initialStatus, startedAt }: { letterId: string; initialEvents: QueryEventRow[]; initialStatus: QueryStatus; startedAt: string }) {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [status, setStatus] = useState(initialStatus);
  const [now, setNow] = useState(() => Date.now());
  const running = status === "PROCESSING" || status === "RECEIVED";

  useEffect(() => setEvents(initialEvents), [initialEvents]);
  useEffect(() => setStatus(initialStatus), [initialStatus]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") return;
    const supabase = createClient();
    const ch = supabase
      .channel(`letter-${letterId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "query_letter_events", filter: `query_letter_id=eq.${letterId}` }, (p) =>
        setEvents((prev) => (prev.some((e) => e.id === (p.new as QueryEventRow).id) ? prev : [...prev, p.new as QueryEventRow])),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "query_letters", filter: `id=eq.${letterId}` }, (p) => {
        const s = (p.new as { status: QueryStatus }).status;
        setStatus(s);
        if (!["PROCESSING", "RECEIVED"].includes(s)) router.refresh();
      })
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [letterId, router]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  const latest = useMemo(() => {
    const m = new Map<PipelineStep, QueryEventRow>();
    for (const e of [...events].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)) m.set(e.step, e);
    return m;
  }, [events]);
  const lastEventAt = events.length ? Math.max(...events.map((e) => new Date(e.created_at).getTime())) : new Date(startedAt).getTime();
  const elapsed = ((running ? now : lastEventAt) - new Date(startedAt).getTime()) / 1000;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Pipeline</h2><StatusChip status={status} /></div>
        <span className={cn("text-sm tabular-nums", elapsed > 20 ? "text-orange-700" : "text-ink-muted")}>{Math.max(0, elapsed).toFixed(1)}s{running ? "" : " total"} · target 20s</span>
      </div>
      <ol className="px-5 py-2">
        {STEPS.map((s, i) => {
          const e = latest.get(s.step);
          const firstPending = STEPS.findIndex((x) => !latest.get(x.step));
          const isCurrent = running && (e?.status === "STARTED" || (!e && i === firstPending));
          const icon =
            e?.status === "SUCCEEDED" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> :
            e?.status === "FAILED" ? <XCircle className="h-5 w-5 text-orange-600" /> :
            e?.status === "SKIPPED" ? <MinusCircle className="h-5 w-5 text-slate-400" /> :
            isCurrent ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> :
            <Circle className="h-5 w-5 text-slate-300" />;
          return (
            <li key={s.step} className="relative flex gap-3 py-3">
              {i < STEPS.length - 1 && <span className="absolute left-[9.5px] top-9 h-[calc(100%-24px)] w-px bg-line" aria-hidden />}
              <span className="relative z-10 bg-white">{icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className={cn("text-sm font-medium", !e && !isCurrent && "text-ink-muted")}>{s.label}</p>
                  {e?.duration_ms != null && e.duration_ms > 0 && <span className="text-xs tabular-nums text-ink-muted">{(e.duration_ms / 1000).toFixed(1)}s{e.attempt > 1 ? ` · attempt ${e.attempt}` : ""}</span>}
                </div>
                <p className={cn("text-xs", e?.status === "FAILED" ? "text-orange-700" : "text-ink-muted")}>{e?.detail ?? s.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
