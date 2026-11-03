import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DecisionChip } from "@/components/chips";
import { ProcessingView } from "@/components/processing-view";
import { Card, CardHeader } from "@/components/ui/misc";
import { requireStaff } from "@/lib/auth";
import { getLetterView } from "@/lib/data";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Processing" };
export const dynamic = "force-dynamic";

export default async function QueryPage({ params }: { params: { id: string } }) {
  await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const view = await getLetterView(params.id);
  if (!view) notFound();
  const { letter, patient, events, points } = view;

  return (
    <div className="space-y-6">
      <Link href={`/patients/${patient.id}`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" />{patient.full_name}
      </Link>
      <div>
        <h1 className="font-serif text-2xl font-normal tracking-tight">Query letter</h1>
        <p className="mt-1 text-sm text-ink-muted">
          <span className="font-mono">{patient.patient_code}</span> · {letter.original_name} · received {formatDate(letter.received_at, true)}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <ProcessingView letterId={letter.id} initialEvents={events} initialStatus={letter.status} startedAt={letter.received_at} />
        <Card>
          <CardHeader title="Points found" description={points.length ? "Each separate ask in the letter" : "Points appear here as soon as the letter is analysed."} />
          {points.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">Waiting…</p>
          ) : (
            <ul className="divide-y divide-line">
              {points.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.point_no}. {p.insurer_ask}</p>
                    <p className="text-xs text-ink-muted">{p.reason ?? p.point_text}</p>
                  </div>
                  <DecisionChip decision={p.decision} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
