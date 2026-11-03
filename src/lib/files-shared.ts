// Safe to import from client components (no server deps).
export const BUCKET = "patient-files";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/tiff"];
export const ACCEPT_ATTR: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/tiff": [".tif", ".tiff"],
};

export const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
export const storagePath = (patientId: string, kind: "document" | "query", name: string) =>
  `${patientId}/${kind === "document" ? "documents" : "queries"}/${crypto.randomUUID()}-${safeName(name)}`;
