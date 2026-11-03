import { Card, Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading patient">
      <Skeleton className="h-4 w-20" />
      <Card className="space-y-3 p-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-80" />
      </Card>
      <Card className="space-y-4 p-6">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-card" />)}
      </div>
    </div>
  );
}
