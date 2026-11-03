import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BulkUpload } from "@/components/bulk-upload";
import { requireAdmin } from "@/lib/auth";
import { listPatientPicker } from "@/lib/data";

export const metadata: Metadata = { title: "Bulk upload" };
export const dynamic = "force-dynamic";

export default async function BulkUploadPage() {
  await requireAdmin();
  const patients = await listPatientPicker();
  return (
    <div className="space-y-6">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Settings</Link>
      <div>
        <h1 className="font-serif text-2xl font-normal tracking-tight">Bulk upload query letters</h1>
        <p className="mt-1 text-sm text-ink-muted">Each letter is processed and the patient messaged automatically, the same as a single upload.</p>
      </div>
      <BulkUpload patients={patients} />
    </div>
  );
}
