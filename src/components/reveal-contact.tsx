"use client";
import { useState, useTransition } from "react";
import { Eye, EyeOff, Mail, Phone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { revealContact } from "@/app/actions";

export function RevealContact({ patientId, phone, email, policy }: { patientId: string; phone: string | null; email: string | null; policy: string | null }) {
  const [revealed, setRevealed] = useState<{ phone: string | null; email: string | null; policy_number: string | null } | null>(null);
  const [pending, start] = useTransition();

  const toggle = () => {
    if (revealed) return setRevealed(null);
    start(async () => {
      const res = await revealContact(patientId);
      if (!res.ok) return void toast.error(res.error);
      setRevealed(res.data!);
      toast.message("Contact details revealed", { description: "This view was recorded in the audit log." });
      setTimeout(() => setRevealed(null), 30_000); // auto re-mask
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-soft">
      <span className="inline-flex items-center gap-1.5 tabular-nums"><Phone className="h-3.5 w-3.5 text-ink-muted" />{(revealed?.phone ?? phone) || "No phone"}</span>
      <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-ink-muted" />{(revealed?.email ?? email) || "No email"}</span>
      <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-ink-muted" />Policy {(revealed?.policy_number ?? policy) || "—"}</span>
      <button type="button" onClick={toggle} disabled={pending} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-purple hover:bg-primary-soft disabled:opacity-60">
        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {pending ? "Revealing…" : revealed ? "Hide" : "Reveal"}
      </button>
    </div>
  );
}
