import { NextResponse, type NextRequest } from "next/server";
import { getStaff } from "@/lib/auth";
import { isDemo } from "@/lib/env";
import { BUCKET } from "@/lib/files-shared";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/files/document/<id>         → 302 to a 60-second signed URL (inline preview)
 * GET /api/files/query/<id>?download=1 → same, as a download
 * Access is checked by RLS (the row and the storage object are both read as the user).
 * Every call is written to the audit log.
 */
export async function GET(req: NextRequest, { params }: { params: { kind: string; id: string } }) {
  if (isDemo) return NextResponse.json({ error: "Files are not available in demo mode." }, { status: 404 });
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id) || !["document", "query"].includes(params.kind)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const db = createClient();
  const table = params.kind === "document" ? "documents" : "query_letters";
  const { data } = await db.from(table).select("file_path, original_name").eq("id", params.id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const download = req.nextUrl.searchParams.get("download") === "1";
  const { data: signed, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(data.file_path, 60, download ? { download: data.original_name ?? true } : undefined);
  if (error || !signed) return NextResponse.json({ error: "Could not create link" }, { status: 500 });

  await db.rpc("log_audit", {
    p_action: download ? "DOWNLOAD_FILE" : "VIEW_FILE",
    p_entity: table,
    p_entity_id: params.id,
  });
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
