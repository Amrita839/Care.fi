"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  next: z.string().optional(),
});

export type LoginState = { error?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) return { error: "Email or password is incorrect." };

  // Must be a staff member, not just any Supabase user.
  const { data: staff } = await supabase.from("staff_users").select("id").eq("id", data.user.id).maybeSingle();
  if (!staff) {
    await supabase.auth.signOut();
    return { error: "This account doesn't have portal access. Ask an admin to add you." };
  }

  await supabase.rpc("log_audit", { p_action: "LOGIN", p_entity: "staff_users", p_entity_id: data.user.id });

  // Only allow same-site relative redirects.
  const next = parsed.data.next;
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/patients");
}
