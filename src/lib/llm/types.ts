/** Provider-neutral model input. `file` = base64 PDF or JPEG. */
export type LlmPart = { type: "file"; mime: string; data: string } | { type: "text"; text: string };

export type ChatTurn = { role: "user" | "assistant"; parts: LlmPart[] };

/** Transport error worth retrying (rate limit, 5xx, timeout). Inngest backs off and retries the step. */
export class RetryableLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableLlmError";
  }
}
