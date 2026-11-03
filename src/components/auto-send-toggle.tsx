"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setAutoSend } from "@/app/actions";
import { Switch } from "@/components/ui/switch";

export function AutoSendToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3">
      <Switch
        id="auto-send"
        checked={on}
        disabled={pending}
        onCheckedChange={(v) =>
          start(async () => {
            setOn(v);
            const r = await setAutoSend(v);
            if (!r.ok) {
              setOn(!v);
              toast.error(r.error);
            } else toast.success(v ? "Auto-send is ON" : "Auto-send is OFF — messages will wait as drafts");
          })
        }
      />
      <label htmlFor="auto-send" className="text-sm font-medium">{on ? "On" : "Off"}</label>
    </div>
  );
}
