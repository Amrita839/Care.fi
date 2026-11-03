"use client";
import { AlertTriangle } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={<AlertTriangle />}
        title="Something went wrong"
        body={error.message || "We couldn't load this page."}
        action={<Button variant="secondary" onClick={reset}>Try again</Button>}
      />
    </Card>
  );
}
