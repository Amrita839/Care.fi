import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PipelineStep, QueryStatus, StepStatus } from "@/lib/types";

/** Writes one pipeline event row + updates the letter's current step. Never throws (tracking must not break the pipeline). */
export async function track(
  queryLetterId: string,
  step: PipelineStep,
  status: StepStatus,
  opts: { detail?: string | null; ms?: number; attempt?: number; letter?: Record<string, unknown> } = {},
) {
  try {
    const db = createAdminClient();
    await db.from("query_letter_events").insert({
      query_letter_id: queryLetterId,
      step,
      status,
      attempt: (opts.attempt ?? 0) + 1,
      detail: opts.detail?.slice(0, 500) ?? null,
      duration_ms: opts.ms ?? null,
    });
    await db
      .from("query_letters")
      .update({
        current_step: step,
        ...(status === "FAILED" ? { last_error: opts.detail?.slice(0, 500) ?? null } : {}),
        ...(opts.letter ?? {}),
      })
      .eq("id", queryLetterId);
  } catch (e) {
    console.error("[track] failed", { queryLetterId, step, status, err: (e as Error).message });
  }
}

export async function setLetter(queryLetterId: string, patch: { status?: QueryStatus } & Record<string, unknown>) {
  const { error } = await createAdminClient().from("query_letters").update(patch).eq("id", queryLetterId);
  if (error) throw new Error(`update letter failed: ${error.message}`);
}

/** Time a block and return [result, ms]. */
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const r = await fn();
  return [r, Date.now() - t];
}
