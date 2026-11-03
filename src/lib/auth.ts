import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { isDemo } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type StaffRole = "admin" | "agent";
export interface Staff {
  id: string;
  email: string;
  full_name: string;
  role: StaffRole;
}

/**
 * Current staff member, or null. Cached per request.
 * A Supabase user with no staff_users row is treated as not authorised.
 */
export const getStaff = cache(async (): Promise<Staff | null> => {
  if (isDemo) {
    const { demoStaff } = await import("@/lib/demo");
    return demoStaff;
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("staff_users")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Staff;
});

export async function requireStaff(): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/login?error=not_staff");
  return staff;
}

export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff();
  if (staff.role !== "admin") redirect("/patients?error=admin_only");
  return staff;
}
