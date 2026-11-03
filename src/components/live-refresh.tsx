"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Re-renders the server page when this patient's letters / points / messages / documents change (Supabase Realtime, RLS-filtered). */
export function LiveRefresh({ patientId, letterIds }: { patientId: string; letterIds: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const key = letterIds.join(",");

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") return;
    const supabase = createClient();
    const refresh = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    const ch = supabase
      .channel(`patient-${patientId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "query_letters", filter: `patient_id=eq.${patientId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `patient_id=eq.${patientId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `patient_id=eq.${patientId}` }, refresh);
    if (key) ch.on("postgres_changes", { event: "*", schema: "public", table: "query_points", filter: `query_letter_id=in.(${key})` }, refresh);
    ch.subscribe();
    return () => {
      clearTimeout(timer.current);
      void supabase.removeChannel(ch);
    };
  }, [patientId, key, router]);

  return null;
}
