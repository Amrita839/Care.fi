import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { inngest, EVENTS } from "@/inngest/client";

export const dynamic = "force-dynamic";

/**
 * Optional Supabase Database Webhook (INSERT on public.query_letters / public.documents).
 * The portal already emits events itself; this catches rows created any other way
 * (SQL, bulk imports, another service). Event ids match the portal's, so Inngest
 * de-duplicates and nothing is processed twice.
 * Configure in Supabase → Database → Webhooks with header  x-webhook-secret: $SUPABASE_WEBHOOK_SECRET
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SUPABASE_WEBHOOK_SECRET;
  const got = req.headers.get("x-webhook-secret") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { type?: string; table?: string; record?: { id?: string } } | null;
  const id = body?.record?.id;
  if (body?.type !== "INSERT" || !id) return NextResponse.json({ ignored: true });

  if (body.table === "query_letters") {
    await inngest.send({ id: `ql-${id}`, name: EVENTS.queryLetterReceived, data: { queryLetterId: id } });
  } else if (body.table === "documents") {
    await inngest.send({ id: `doc-${id}`, name: EVENTS.documentUploaded, data: { documentId: id } });
  }
  return NextResponse.json({ ok: true });
}
