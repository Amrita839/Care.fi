"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { CheckCircle2, FileUp, Loader2, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";
import { registerUpload } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { ACCEPT_ATTR, BUCKET, MAX_FILE_BYTES, storagePath } from "@/lib/files-shared";
import { cn, formatBytes } from "@/lib/utils";

type Item = { file: File; state: "queued" | "uploading" | "done" | "error"; error?: string };

/** Uploads straight from the browser to the PRIVATE bucket (RLS-checked), then registers the row server-side. */
export async function uploadOne(patientId: string, kind: "document" | "query", file: File) {
  const path = storagePath(patientId, kind, file.name);
  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  const res = await registerUpload({ patientId, kind, path, originalName: file.name, mime: file.type, size: file.size });
  if (!res.ok) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
    throw new Error(res.error);
  }
  return res.data!.id;
}

export function UploadDialog({ patientId, kind, trigger }: { patientId: string; kind: "document" | "query"; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const multiple = kind === "document";

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      rejected.forEach((r) => toast.error(`${r.file.name}: ${r.errors[0]?.message ?? "rejected"}`));
      setItems((prev) => (multiple ? [...prev, ...accepted.map((file) => ({ file, state: "queued" as const }))] : accepted.slice(0, 1).map((file) => ({ file, state: "queued" as const }))));
    },
    [multiple],
  );
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: ACCEPT_ATTR, maxSize: MAX_FILE_BYTES, multiple });

  const upload = async () => {
    setBusy(true);
    let ok = 0;
    let lastId: string | null = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].state === "done") continue;
      setItems((p) => p.map((it, j) => (j === i ? { ...it, state: "uploading" } : it)));
      try {
        lastId = await uploadOne(patientId, kind, items[i].file);
        ok++;
        setItems((p) => p.map((it, j) => (j === i ? { ...it, state: "done" } : it)));
      } catch (e) {
        setItems((p) => p.map((it, j) => (j === i ? { ...it, state: "error", error: (e as Error).message } : it)));
      }
    }
    setBusy(false);
    if (ok > 0) {
      router.refresh();
      if (kind === "query" && lastId) {
        toast.success("Query letter received — processing started automatically.");
        setOpen(false);
        setItems([]);
        router.push(`/queries/${lastId}`);
      } else {
        toast.success(`${ok} document${ok > 1 ? "s" : ""} uploaded — classifying automatically.`);
      }
    }
  };

  const allDone = items.length > 0 && items.every((i) => i.state === "done");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { setOpen(o); if (!o) setItems([]); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={kind === "query" ? "Upload insurer query letter" : "Upload documents"}
        description={
          kind === "query"
            ? "The letter is read, matched against the locker and the patient is messaged automatically."
            : "PDF or photos, up to 25 MB each. Each file is classified automatically."
        }
      >
        <div
          {...getRootProps()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-line bg-canvas/50 px-6 py-10 text-center transition hover:border-primary/50",
            isDragActive && "border-primary bg-primary-soft",
          )}
        >
          <input {...getInputProps()} aria-label="Choose files" />
          <UploadCloud className="mb-2 h-8 w-8 text-primary" />
          <p className="text-sm font-medium">{isDragActive ? "Drop to add" : multiple ? "Drag files here, or click to choose" : "Drag the letter here, or click to choose"}</p>
          <p className="mt-1 text-xs text-ink-muted">PDF, JPG, PNG, WEBP, HEIC, TIFF</p>
        </div>

        {items.length > 0 && (
          <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto">
            {items.map((it, i) => (
              <li key={`${it.file.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <FileUp className="h-4 w-4 shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{it.file.name}</p>
                  {it.error ? <p className="truncate text-xs text-rose-600">{it.error}</p> : <p className="text-xs text-ink-muted">{formatBytes(it.file.size)}</p>}
                </div>
                {it.state === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {it.state === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                {it.state === "error" && <XCircle className="h-4 w-4 text-rose-600" />}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{allDone ? "Close" : "Cancel"}</Button>
          {!allDone && (
            <Button onClick={upload} loading={busy} disabled={items.length === 0}>
              {kind === "query" ? "Upload and process" : `Upload ${items.length || ""}`.trim()}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
