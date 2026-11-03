import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { verifyTwilioSignature } from "@/lib/messaging/providers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Twilio StatusCallback → updates messages.status to DELIVERED / FAILED. Signature-verified. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = `${publicEnv.NEXT_PUBLIC_APP_URL}${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (!verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }
  const mid = req.nextUrl.searchParams.get("mid");
  const status = params.MessageStatus;
  if (!mid || !/^[0-9a-f-]{36}$/i.test(mid)) return NextResponse.json({ ok: true });

  const db = createAdminClient();
  if (status === "delivered" || status === "read") {
    await db.from("messages").update({ status: "DELIVERED", delivered_at: new Date().toISOString() }).eq("id", mid).eq("provider_message_id", params.MessageSid);
  } else if (status === "failed" || status === "undelivered") {
    await db
      .from("messages")
      .update({ status: "FAILED", error: `Twilio: ${status}${params.ErrorCode ? ` (${params.ErrorCode})` : ""}` })
      .eq("id", mid)
      .eq("provider_message_id", params.MessageSid);
  }
  return NextResponse.json({ ok: true });
}
