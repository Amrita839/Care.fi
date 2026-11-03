import "server-only";
import { z } from "zod";

/**
 * Server-only secrets, validated lazily: each integration reads only what it needs, so an
 * unused provider's keys can stay empty. (LLM + messaging providers read process.env directly.)
 */
const schema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});
type ServerEnv = z.infer<typeof schema>;

export function serverEnv<K extends keyof ServerEnv>(key: K): ServerEnv[K] {
  const parsed = schema.shape[key].safeParse(process.env[key]);
  if (!parsed.success) {
    throw new Error(`Missing or invalid env var ${String(key)} — see .env.example`);
  }
  return parsed.data as ServerEnv[K];
}
