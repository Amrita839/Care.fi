import "server-only";
import type { z } from "zod";
import { activeProvider } from "@/lib/llm/providers";
import type { ChatTurn, LlmPart } from "@/lib/llm/types";

export type JsonResult<T> =
  | { ok: true; data: T; attempts: number; ms: number; model: string }
  | { ok: false; error: string; attempts: number; ms: number; model: string };

function firstJsonObject(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * One structured model call (Gemini by default), Zod-validated. On a validation failure the model
 * is shown its errors and asked once more (2 attempts total) — then the caller falls back to NEEDS_REVIEW.
 * Rate-limit / 5xx errors throw RetryableLlmError so the Inngest step retries with backoff.
 */
export async function callJson<T>(opts: {
  system: string;
  content: LlmPart[];
  zod: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
  check?: (data: T) => string | null;
}): Promise<JsonResult<T>> {
  const started = Date.now();
  const provider = activeProvider();
  const turns: ChatTurn[] = [{ role: "user", parts: opts.content }];
  let lastError = "unknown";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text, truncated } = await provider.generate({
      system: opts.system,
      turns,
      jsonSchema: opts.jsonSchema,
      maxTokens: opts.maxTokens ?? 4000,
    });
    const retryWith = (msg: string) =>
      turns.push(
        { role: "assistant", parts: [{ type: "text", text: text || "(empty)" }] },
        { role: "user", parts: [{ type: "text", text: msg }] },
      );

    if (truncated) {
      lastError = "output truncated (max tokens)";
      retryWith("Your output was cut off. Return a shorter, complete JSON object.");
      continue;
    }
    let parsed: unknown;
    try {
      parsed = firstJsonObject(text);
    } catch (e) {
      lastError = `invalid JSON: ${(e as Error).message}`;
      retryWith(`That was not valid JSON (${lastError}). Return ONLY the corrected JSON object.`);
      continue;
    }
    const result = opts.zod.safeParse(parsed);
    const semantic = result.success && opts.check ? opts.check(result.data) : null;
    if (result.success && !semantic) {
      return { ok: true, data: result.data, attempts: attempt, ms: Date.now() - started, model: `${provider.name}:${provider.model()}` };
    }
    lastError =
      semantic ??
      (result.success ? "check failed" : result.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    retryWith(`Your JSON failed validation: ${lastError}. Fix these problems and return ONLY the corrected JSON object.`);
  }
  return { ok: false, error: lastError, attempts: 2, ms: Date.now() - started, model: `${provider.name}:${provider.model()}` };
}
