import type { Metadata } from "next";
import Link from "next/link";
import { FolderUp, ScrollText } from "lucide-react";
import { AutoSendToggle } from "@/components/auto-send-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/misc";
import { requireAdmin } from "@/lib/auth";
import { getSettings, listAudit } from "@/lib/data";
import { composeMessages } from "@/lib/pipeline/logic";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const SAMPLE = composeMessages({
  patient_name: "Rajesh Kumar Verma",
  patient_code: "PL-100101",
  insurer: "Star Health",
  claim_ref: "CLM2609-55102",
  points: [
    { point_no: 1, decision: "NEED_FROM_PATIENT", needs_review: false, needed_doc_type: "OTHER", insurer_ask: "Hospital's daily treatment notes", why_needed: "To see the treatment given each day" },
    { point_no: 2, decision: "HAVE", needs_review: false, needed_doc_type: "FINAL_BILL", insurer_ask: "Itemised final bill", why_needed: null },
    { point_no: 3, decision: "NEED_FROM_PATIENT", needs_review: false, needed_doc_type: "CONSULTATION_PAPER", insurer_ask: "Paper from your first doctor visit", why_needed: "To know when the symptoms started" },
    { point_no: 4, decision: "HAVE_BUT_UNCLEAR", needs_review: true, needed_doc_type: "INVESTIGATION_REPORT", insurer_ask: "Daily platelet reports", why_needed: null },
  ],
});

export default async function SettingsPage() {
  await requireAdmin();
  const [settings, audit] = await Promise.all([getSettings(), listAudit(25)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-normal tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Admins only.</p>
      </div>

      <Card>
        <CardHeader
          title="Auto-send messages"
          description="When on, patients are messaged on WhatsApp and email as soon as a query letter is analysed. When off, messages are saved as drafts for an agent to approve."
          action={<AutoSendToggle initial={settings.auto_send} />}
        />
        <p className="px-5 py-3 text-xs text-ink-muted">Low-confidence points are never sent, whatever this setting is.{settings.updated_at ? ` Last changed ${formatDate(settings.updated_at, true)}.` : ""}</p>
      </Card>

      <Card>
        <CardHeader title="Connected services" description="Set in .env.local / Vercel env vars. All defaults are free." />
        <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-3">
          {[
            ["AI (reading + matching)", `${process.env.AI_PROVIDER || "gemini"} · ${process.env.AI_PROVIDER === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5" : process.env.GEMINI_MODEL || "gemini-3.8-flash"}`],
            ["WhatsApp", process.env.WHATSAPP_PROVIDER || "log"],
            ["Email", process.env.EMAIL_PROVIDER || "log"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-ink-muted">{k}</dt>
              <dd className="mt-0.5 font-medium">{v}{v === "log" ? <span className="font-normal text-ink-muted"> — saved in portal, not delivered</span> : null}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardHeader title="Message template" description={<>Edit <code className="rounded bg-canvas px-1 py-0.5 text-xs">config/message-template.ts</code> to change the wording. Preview with sample data:</>} />
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">WhatsApp</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-[#E7F7EE] p-4 font-sans text-sm leading-relaxed text-ink">{SAMPLE.whatsapp}</pre>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Email</p>
            <div className="rounded-lg border border-line">
              <p className="border-b border-line px-4 py-2 text-sm font-medium">{SAMPLE.emailSubject}</p>
              <pre className="whitespace-pre-wrap p-4 font-sans text-sm leading-relaxed text-ink">{SAMPLE.emailBody}</pre>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Bulk upload query letters"
          description="Upload many letters at once. Each is matched to a patient by the patient ID in the file name (e.g. PL-100101_query.pdf), or you can pick one."
          action={<Button asChild variant="secondary"><Link href="/settings/bulk-upload"><FolderUp />Open bulk upload</Link></Button>}
        />
      </Card>

      <Card>
        <CardHeader title="Recent audit log" description="Every view, download, reveal, edit and resend." action={<ScrollText className="h-5 w-5 text-ink-muted" />} />
        {audit.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">No entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr><th className="px-5 py-2">When</th><th className="px-5 py-2">Action</th><th className="px-5 py-2">Entity</th><th className="px-5 py-2">User</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="px-5 py-2.5 text-ink-muted">{formatDate(a.created_at, true)}</td>
                    <td className="px-5 py-2.5 font-medium">{a.action}</td>
                    <td className="px-5 py-2.5 text-ink-soft">{a.entity} <span className="font-mono text-xs text-ink-muted">{a.entity_id?.slice(0, 8)}</span></td>
                    <td className="px-5 py-2.5 font-mono text-xs text-ink-muted">{a.user_id?.slice(0, 8) ?? "system"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
