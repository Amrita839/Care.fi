"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useDropzone, type FileRejection } from "react-dropzone";
import { CheckCircle2, Loader2, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";
import { uploadOne } from "@/components/upload-dialog";
import { Button } from "@/components/ui/button";
import { Card, NativeSelect } from "@/components/ui/misc";
import { ACCEPT_ATTR, MAX_FILE_BYTES } from "@/lib/files-shared";
import { patientCodeFromFilename } from "@/lib/pipeline/logic";
import { cn, formatBytes } from "@/lib/utils";

type Row = { file: File; patientId: string; state: "ready" | "uploading" | "done" | "error"; error?: string; letterId?: string; auto: boolean };

export function BulkUpload({ patients }: { patients: { id: string; patient_code: string; full_name: string }[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const byCode = useMemo(() => new Map(patients.map((p) => [p.patient_code, p.id])), [patients]);

  const onDrop = useCallback(
    (files: File[], rejected: FileRejection[]) => {
      rejected.forEach((r) => toast.error(`${r.file.name}: ${r.errors[0]?.message}`));
      setRows((prev) => [
        ...prev,
        ...files.map((file) => {
          const code = patientCodeFromFilename(file.name);
          const id = code ? byCode.get(code) ?? "" : "";
          return { file, patientId: id, state: "ready" as const, auto: !!id };
        }),
      ]);
    },
    [byCode],
  );
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: ACCEPT_ATTR, maxSize: MAX_FILE_BYTES, multiple: true });

  const ready = rows.filter((r) => r.state !== "done");
  const unmapped = ready.filter((r) => !r.patientId).length;

  const uploadAll = async () => {
    setBusy(true);
    // 3 at a time
    const queue = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.state !== "done" && r.patientId);
    let ok = 0;
    const worker = async () => {
      while (queue.length) {
        const { r, i } = queue.shift()!;
        setRows((p) => p.map((x, j) => (j === i ? { ...x, state: "uploading", error: undefined } : x)));
        try {
          const letterId = await uploadOne(r.patientId, "query", r.file);
          ok++;
          setRows((p) => p.map((x, j) => (j === i ? { ...x, state: "done", letterId } : x)));
        } catch (e) {
          setRows((p) => p.map((x, j) => (j === i ? { ...x, state: "error", error: (e as Error).message } : x)));
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setBusy(false);
    if (ok) toast.success(`${ok} letter${ok > 1 ? "s" : ""} uploaded — processing automatically.`);
  };

  return (
    <div className="space-y-5">
      <div
        {...getRootProps()}
        className={cn("card flex cursor-pointer flex-col items-center justify-center border-2 border-dashed px-6 py-14 text-center transition hover:border-primary/50", isDragActive && "border-primary bg-primary-soft")}
      >
        <input {...getInputProps()} aria-label="Choose query letters" />
        <UploadCloud className="mb-2 h-9 w-9 text-primary" />
        <p className="font-medium">Drop query letters here, or click to choose</p>
        <p className="mt-1 text-sm text-ink-muted">Put the patient ID in the file name to map automatically, e.g. <span className="font-mono">PL-100103_ICICI.pdf</span></p>
      </div>

      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <p className="text-sm text-ink-muted">
              {rows.length} file{rows.length > 1 ? "s" : ""}{unmapped ? <span className="font-medium text-orange-700"> · {unmapped} need a patient</span> : ""}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRows([])} disabled={busy}>Clear</Button>
              <Button size="sm" onClick={uploadAll} loading={busy} disabled={ready.length === 0 || ready.every((r) => !r.patientId)}>
                Upload {ready.filter((r) => r.patientId).length} and process
              </Button>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((r, i) => (
              <li key={`${r.file.name}-${i}`} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.file.name}</p>
                  <p className="text-xs text-ink-muted">{formatBytes(r.file.size)}{r.auto ? " · matched from file name" : ""}</p>
                  {r.error && <p className="text-xs text-rose-600">{r.error}</p>}
                </div>
                <NativeSelect
                  value={r.patientId}
                  disabled={r.state === "done" || r.state === "uploading"}
                  onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, patientId: e.target.value, auto: false } : x)))}
                  className={cn("h-9 sm:w-72", !r.patientId && "border-orange-300")}
                  aria-label={`Patient for ${r.file.name}`}
                >
                  <option value="">Choose patient…</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.patient_code} · {p.full_name}</option>)}
                </NativeSelect>
                <div className="w-24 text-right text-xs">
                  {r.state === "uploading" && <Loader2 className="ml-auto h-4 w-4 animate-spin text-primary" />}
                  {r.state === "done" && <Link href={`/queries/${r.letterId}`} className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline"><CheckCircle2 className="h-4 w-4" />Track</Link>}
                  {r.state === "error" && <XCircle className="ml-auto h-4 w-4 text-rose-600" />}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
