import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Search, Users } from "lucide-react";
import { StatusChip } from "@/components/chips";
import { Card, EmptyState, NativeSelect } from "@/components/ui/misc";
import { requireStaff } from "@/lib/auth";
import { listPatients } from "@/lib/data";
import { QUERY_STATUSES } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Patients" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Received", PROCESSING: "Processing", SENT: "Sent", PARTIALLY_SENT: "Partly sent",
  FAILED: "Failed", NEEDS_REVIEW: "Needs review", RESOLVED: "Resolved",
};

export default async function PatientsPage({ searchParams }: { searchParams: { q?: string; status?: string } }) {
  const staff = await requireStaff();
  const patients = await listPatients(searchParams);
  const reviewCount = patients.filter((p) => p.latest_query_status === "NEEDS_REVIEW").length;
  const filtered = !!(searchParams.q || (searchParams.status && searchParams.status !== "ALL"));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-normal tracking-tight">Patients</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {staff.role === "admin" ? "All patients" : "Patients assigned to you"} · {patients.length} shown
            {reviewCount > 0 && <span className="font-medium text-orange-700"> · {reviewCount} need review</span>}
          </p>
        </div>
      </div>

      <form className="flex flex-col gap-3 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input name="q" defaultValue={searchParams.q} placeholder="Search by name or patient ID" className="input pl-9" aria-label="Search patients" />
        </div>
        <NativeSelect name="status" defaultValue={searchParams.status ?? "ALL"} aria-label="Filter by status" className="sm:w-48">
          <option value="ALL">All statuses</option>
          {QUERY_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
          <option value="NONE">No queries</option>
        </NativeSelect>
        <button className="btn-primary sm:w-auto" type="submit">Apply</button>
      </form>

      <Card className="overflow-hidden">
        {patients.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={filtered ? "No patients match" : "No patients yet"}
            body={filtered ? "Try a different name, patient ID or status." : staff.role === "agent" ? "Patients appear here once an admin assigns them to you." : "Add patients in Supabase or via the seed script."}
            action={filtered ? <Link className="btn-ghost" href="/patients">Clear filters</Link> : undefined}
          />
        ) : (
          <>
            {/* table ≥ md */}
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-canvas/60 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-5 py-3">Patient ID</th>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Insurer</th>
                  <th className="px-5 py-3">Latest query</th>
                  <th className="px-5 py-3">Last activity</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {patients.map((p) => (
                  <tr key={p.id} className="group relative transition hover:bg-canvas/60">
                    <td className="px-5 py-3.5 font-mono text-xs text-ink-soft">{p.patient_code}</td>
                    <td className="px-5 py-3.5 font-medium">
                      <Link href={`/patients/${p.id}`} className="after:absolute after:inset-0 focus:outline-none">{p.full_name}</Link>
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-ink-soft">{p.phone_masked ?? "—"}</td>
                    <td className="px-5 py-3.5 text-ink-soft">{p.insurer ?? "—"}</td>
                    <td className="px-5 py-3.5"><StatusChip status={p.latest_query_status} /></td>
                    <td className="px-5 py-3.5 text-ink-muted">{timeAgo(p.last_activity_at)}</td>
                    <td className="pr-4"><ChevronRight className="h-4 w-4 text-ink-muted opacity-0 transition group-hover:opacity-100" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* cards < md */}
            <ul className="divide-y divide-line md:hidden">
              {patients.map((p) => (
                <li key={p.id}>
                  <Link href={`/patients/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-canvas">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.full_name}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        <span className="font-mono">{p.patient_code}</span> · {p.phone_masked} · {timeAgo(p.last_activity_at)}
                      </p>
                    </div>
                    <StatusChip status={p.latest_query_status} />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
