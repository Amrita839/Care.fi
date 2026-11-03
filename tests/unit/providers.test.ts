import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const okBody = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }), { status: 200 });

describe("Gemini provider via callJson", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "model-a";
    process.env.GEMINI_FALLBACK_MODELS = "model-b";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends inline file + JSON mode and validates with Zod", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okBody('{"x": 1}'));
    vi.stubGlobal("fetch", fetchMock);
    const { callJson } = await import("@/lib/llm/client");
    const r = await callJson({
      system: "sys",
      content: [{ type: "file", mime: "application/pdf", data: "QUJD" }, { type: "text", text: "go" }],
      zod: z.object({ x: z.number() }),
      jsonSchema: { type: "object" },
    });
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/models/model-a:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[0]).toEqual({ inline_data: { mime_type: "application/pdf", data: "QUJD" } });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.system_instruction.parts[0].text).toBe("sys");
  });

  it("falls back to the next model on 404 and retries once on invalid JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("model not found", { status: 404 }))
      .mockResolvedValueOnce(okBody('{"x": "wrong"}'))
      .mockResolvedValueOnce(okBody('```json\n{"x": 2}\n```'));
    vi.stubGlobal("fetch", fetchMock);
    const { callJson } = await import("@/lib/llm/client");
    const r = await callJson({ system: "s", content: [{ type: "text", text: "t" }], zod: z.object({ x: z.number() }), jsonSchema: {} });
    expect(r.ok && r.data.x).toBe(2);
    expect(r.attempts).toBe(2);
    expect(fetchMock.mock.calls[1][0]).toContain("model-b");
    const retryBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(retryBody.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("returns ok:false after two invalid answers (pipeline then goes to NEEDS_REVIEW)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(okBody("not json"))));
    const { callJson } = await import("@/lib/llm/client");
    const r = await callJson({ system: "s", content: [{ type: "text", text: "t" }], zod: z.object({ x: z.number() }), jsonSchema: {} });
    expect(r.ok).toBe(false);
  });

  it("drops the schema and retries if the API rejects responseJsonSchema", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"Unknown name \\"responseJsonSchema\\""}}', { status: 400 }))
      .mockResolvedValueOnce(okBody('{"x": 3}'));
    vi.stubGlobal("fetch", fetchMock);
    const { callJson } = await import("@/lib/llm/client");
    const r = await callJson({ system: "s", content: [{ type: "text", text: "t" }], zod: z.object({ x: z.number() }), jsonSchema: { type: "object" } });
    expect(r.ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).generationConfig.responseJsonSchema).toBeUndefined();
  });
});

describe("free messaging providers", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key-000000000000";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("log mode sends nothing", async () => {
    process.env.WHATSAPP_PROVIDER = "log";
    process.env.EMAIL_PROVIDER = "log";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const p = await import("@/lib/messaging/providers");
    expect((await p.sendWhatsApp({ toE164: "+919800000000", body: "hi", messageId: "m" })).providerMessageId).toMatch(/^log-/);
    expect((await p.sendEmail({ to: "a@b.com", subject: "s", body: "b", idempotencyKey: "k" })).providerMessageId).toMatch(/^log-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("meta mode calls the Cloud API with a text message", async () => {
    process.env.WHATSAPP_PROVIDER = "meta";
    process.env.META_WA_TOKEN = "tok";
    process.env.META_WA_PHONE_NUMBER_ID = "123";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = await import("@/lib/messaging/providers");
    const r = await p.sendWhatsApp({ toE164: "+919800000000", body: "hello", messageId: "m" });
    expect(r.providerMessageId).toBe("wamid.1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/graph\.facebook\.com\/v[\d.]+\/123\/messages/);
    expect(JSON.parse(init.body)).toMatchObject({ to: "919800000000", type: "text", text: { body: "hello" } });
  });

  it("meta expired token (401) is a permanent failure, not retried", async () => {
    process.env.WHATSAPP_PROVIDER = "meta";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Session has expired", code: 190 } }), { status: 401 })));
    const p = await import("@/lib/messaging/providers");
    await expect(p.sendWhatsApp({ toE164: "+919800000000", body: "x", messageId: "m" })).rejects.toBeInstanceOf(p.PermanentSendError);
  });
});
