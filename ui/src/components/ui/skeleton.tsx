import { cn } from "@/lib/utils";

/** loading placeholder; the pulse stops for people who asked the system for less motion */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} />;
}

/** placeholder with the same outline as a server card, so the layout does not jump when results arrive */
export function ServerCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5" aria-busy="true">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" />
      </div>
      <div className="grid gap-3">
        <Skeleton className="h-2 w-full" /><Skeleton className="h-2 w-5/6" /><Skeleton className="h-2 w-2/3" />
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4 p-4" aria-busy="true">
      <div className="flex flex-col gap-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-24" /></div>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}
