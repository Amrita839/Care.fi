import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailProvider, whatsappProvider } from "@/lib/messaging/providers";

export const dynamic = "force-dynamic";

/** Liveness + DB/storage reachability + which providers are configured. Returns no data. */
export async function GET() {
  const started = Date.now();
  const checks: Record<string, string> = {};
  try {
    const db = createAdminClient();
    const { error } = await db.from("app_settings").select("auto_send").limit(1);
    checks.database = error ? error.message : "ok";
    const { error: sErr } = await db.storage.getBucket("patient-files");
    checks.storage = sErr ? sErr.message : "ok";
  } catch (e) {
    checks.config = e instanceof Error ? e.message : "unknown error";
  }
  const ai = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const aiKey = ai === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
  checks.ai = aiKey ? "ok" : `missing ${ai === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY"}`;
  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      providers: { ai, whatsapp: whatsappProvider(), email: emailProvider() },
      ms: Date.now() - started,
    },
    { status: healthy ? 200 : 503 },
  );
}
