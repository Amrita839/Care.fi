import "server-only";
import { RetryAfterError } from "inngest";
import { RetryableLlmError, type ChatTurn, type LlmPart } from "@/lib/llm/types";

/**
 * Model providers. Each takes a system prompt + conversation and returns raw text (expected JSON).
 *   AI_PROVIDER=gemini     (default, FREE tier via Google AI Studio key)
 *   AI_PROVIDER=anthropic  (paid, optional)
 */
export interface GenerateOpts {
  system: string;
  turns: ChatTurn[];
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}
export interface Provider {
  name: string;
  model: () => string;
  generate: (o: GenerateOpts) => Promise<{ text: string; truncated: boolean }>;
}

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k} — see .env.example`);
  return v;
};
const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

// ---------------------------------------------------------------- Gemini (free tier)
/** Models tried in order; the first one your key can use wins (free-tier model names change over time). */
const geminiModels = () =>
  [process.env.GEMINI_MODEL || "gemini-3.8-flash", ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite,gemini-2.5-flash").split(",")]
    .map((m) => m.trim())
    .filter((m, i, a) => m && a.indexOf(m) === i);
let workingGeminiModel: string | null = null;
let geminiSchemaOk = true;

const toGeminiParts = (parts: LlmPart[]) =>
  parts.map((p) => (p.type === "text" ? { text: p.text } : { inline_data: { mime_type: p.mime, data: p.data } }));

async function geminiCall(model: string, o: GenerateOpts) {
  const body = {
    system_instruction: { parts: [{ text: o.system }] },
    contents: o.turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: toGeminiParts(t.parts) })),
    generationConfig: {
      temperature: 0,
      maxOutputTokens: o.maxTokens,
      responseMimeType: "application/json",
      ...(geminiSchemaOk ? { responseJsonSchema: o.jsonSchema } : {}),
    },
  };
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": need("GEMINI_API_KEY") },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
}

export const gemini: Provider = {
  name: "gemini",
  model: () => workingGeminiModel ?? geminiModels()[0],
  async generate(o) {
    const allModels = geminiModels();
    const models = workingGeminiModel
      ? [workingGeminiModel, ...allModels.filter((m) => m !== workingGeminiModel)]
      : allModels;
    let lastErr = "no model available";
    for (const model of models) {
      let res: Response;
      try {
        res = await geminiCall(model, o);
      } catch (err: unknown) {
        lastErr = `Gemini call (${model}): ${err instanceof Error ? err.message : String(err)}`;
        continue;
      }
      if (res.status === 400 && geminiSchemaOk) {
        const t = await res.clone().text();
        if (/responseJsonSchema|response_json_schema|schema/i.test(t)) {
          geminiSchemaOk = false; // older API surface: keep JSON mode, rely on prompt + Zod
          try {
            res = await geminiCall(model, o);
          } catch (err: unknown) {
            lastErr = `Gemini call (${model}): ${err instanceof Error ? err.message : String(err)}`;
            continue;
          }
        }
      }
      if (res.ok) {
        workingGeminiModel = model;
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
          promptFeedback?: { blockReason?: string };
        };
        const c = json.candidates?.[0];
        if (!c) throw new Error(`Gemini returned no answer${json.promptFeedback?.blockReason ? ` (blocked: ${json.promptFeedback.blockReason})` : ""}`);
        return { text: (c.content?.parts ?? []).map((p) => p.text ?? "").join(""), truncated: c.finishReason === "MAX_TOKENS" };
      }
      const errText = (await res.text()).slice(0, 300);
      lastErr = `Gemini ${res.status} (${model}): ${errText}`;
      if (res.status === 503) continue; // high-demand spike: try next fallback model
      if (res.status === 429) {
        if (model !== models[models.length - 1]) continue;
        throw new RetryAfterError(lastErr, "30s"); // free tier rate limit: wait, then Inngest retries
      }
      if (retryable(res.status)) {
        if (model !== models[models.length - 1]) continue;
        throw new RetryableLlmError(lastErr);
      }
      if ([403, 404].includes(res.status) || /not found|not supported|permission/i.test(errText)) continue; // try next model
      throw new Error(lastErr);
    }
    throw new Error(lastErr);
  },
};

// ---------------------------------------------------------------- Anthropic (optional, paid)
export const anthropic: Provider = {
  name: "anthropic",
  model: () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  async generate(o) {
    const content = (parts: LlmPart[]) =>
      parts.map((p) =>
        p.type === "text"
          ? { type: "text", text: p.text }
          : p.mime === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: p.mime, data: p.data } }
            : { type: "image", source: { type: "base64", media_type: p.mime, data: p.data } },
      );
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": need("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: anthropic.model(),
        max_tokens: o.maxTokens,
        system: `${o.system}\n\nRespond with ONLY a JSON object matching this JSON schema:\n${JSON.stringify(o.jsonSchema)}`,
        messages: o.turns.map((t) => ({ role: t.role, content: content(t.parts) })),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const msg = `Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`;
      if (retryable(res.status)) throw new RetryableLlmError(msg);
      throw new Error(msg);
    }
    const json = (await res.json()) as { content: { type: string; text?: string }[]; stop_reason: string };
    return { text: json.content.map((b) => b.text ?? "").join(""), truncated: json.stop_reason === "max_tokens" };
  },
};

export function activeProvider(): Provider {
  return (process.env.AI_PROVIDER || "gemini").toLowerCase() === "anthropic" ? anthropic : gemini;
}
