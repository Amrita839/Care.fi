import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FilePlus2, Inbox, Upload } from "lucide-react";
import { ActiveQueryCard } from "@/components/active-query-card";
import { StatusChip } from "@/components/chips";
import { LiveRefresh } from "@/components/live-refresh";
import { PatientTabs } from "@/components/patient-tabs";
import { RevealContact } from "@/components/reveal-contact";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { UploadDialog } from "@/components/upload-dialog";
import { requireStaff } from "@/lib/auth";
import { getPatientBundle } from "@/lib/data";
import { isDemo } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Patient" };
export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: { params: { id: string } }) {
  await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const bundle = await getPatientBundle(params.id);
  if (!bundle) notFound();
  const { patient, documents, letters, points, messages, events } = bundle;

  if (!isDemo) {
    await createClient().rpc("log_audit", { p_action: "VIEW_PATIENT", p_entity: "patients", p_entity_id: patient.id });
  }

  // Active query = newest letter that isn't resolved (else the newest one).
  const active = letters.find((l) => l.status !== "RESOLVED") ?? letters[0];
  const activePoints = active ? points.filter((p) => p.query_letter_id === active.id).sort((a, b) => a.point_no - b.point_no) : [];
  const hasDrafts = !!active && messages.some((m) => m.query_letter_id === active.id && m.status === "DRAFT");

  const uploadLetter = (
    <UploadDialog patientId={patient.id} kind="query" trigger={<Button><Upload />Upload query letter</Button>} />
  );
  const uploadDoc = (
    <UploadDialog patientId={patient.id} kind="document" trigger={<Button variant="accent"><FilePlus2 />Upload document</Button>} />
  );

  return (
    <div className="space-y-6">
      <LiveRefresh patientId={patient.id} letterIds={letters.map((l) => l.id)} />
      <Link href="/patients" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Patients</Link>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-serif text-xl font-normal tracking-tight sm:text-2xl">{patient.full_name}</h1>
              <StatusChip status={patient.latest_query_status} />
            </div>
            <p className="text-sm text-ink-muted">
              <span className="font-mono text-ink-soft">{patient.patient_code}</span>
              {patient.insurer ? ` · ${patient.insurer}` : ""} · {patient.document_count} documents
            </p>
            <RevealContact patientId={patient.id} phone={patient.phone_masked} email={patient.email_masked} policy={patient.policy_masked} />
          </div>
          <div className="flex flex-wrap gap-2">
            {uploadDoc}
            {uploadLetter}
          </div>
        </div>
      </Card>

      {active ? (
        <ActiveQueryCard letter={active} points={activePoints} docs={documents} hasDrafts={hasDrafts} />
      ) : (
        <Card>
          <EmptyState icon={<Inbox />} title="No insurer queries" body="Upload a query letter when the insurer asks for more information. Everything after that is automatic." action={uploadLetter} />
        </Card>
      )}

      <PatientTabs docs={documents} letters={letters} points={points} events={events} messages={messages} uploadDocButton={uploadDoc} />
    </div>
  );
}
