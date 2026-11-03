import { z } from "zod";

/** DEMO_MODE=1 runs the portal on the seed fixtures with no Supabase (UI review only; writes are disabled). */
export const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

/**
 * Public env (safe in the browser). Next inlines NEXT_PUBLIC_* at build time,
 * so they must be referenced literally.
 */
export const publicEnv = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(isDemo ? 0 : 20),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  })
  .parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || (isDemo ? "http://127.0.0.1:54321" : undefined),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || (isDemo ? "demo" : undefined),
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
  });
