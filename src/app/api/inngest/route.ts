import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Vercel Hobby (free) allows up to 60s per request; each Inngest step is a separate request.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({ client: inngest, functions });
