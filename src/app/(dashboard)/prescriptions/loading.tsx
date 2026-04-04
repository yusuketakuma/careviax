import { Skeleton } from '@/components/ui/loading';

export default function PrescriptionsLoading() {
  return (
    <div className="flex h-[calc(100vh-64px)] flex-col overflow-hidden">
      {/* Status bar skeleton */}
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-20" />
        <div className="mx-1 h-4 w-px bg-border" />
        <Skeleton className="h-3 w-16" />
        <div className="ml-auto flex items-center gap-1.5">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>

      {/* Filter bar skeleton */}
      <div className="flex items-center gap-1.5 border-b px-3 py-1">
        <Skeleton className="h-3 w-8" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-10" />
        ))}
        <div className="mx-1 h-3 w-px bg-border" />
        <Skeleton className="h-3 w-8" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-8" />
        ))}
      </div>

      {/* Master-detail skeleton */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[420px] shrink-0 border-r p-2 lg:w-[480px]">
          <div className="space-y-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Skeleton className="h-10 w-10 rounded-full opacity-20" />
        </div>
      </div>
    </div>
  );
}
