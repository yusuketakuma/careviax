import { Skeleton } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function DashboardLoading() {
  return (
    <div>
      <div className="border-b border-border px-6 py-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-48" />
      </div>
      <PageScaffold stackClassName="[&>*]:rounded-none [&>*]:border-0 [&>*]:bg-transparent [&>*]:p-0 [&>*]:shadow-none">
        <div className="rounded-2xl border border-border/70 bg-card shadow-sm">
          <div className="space-y-2 border-b border-border/70 px-5 py-4 sm:px-6">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="grid gap-6 px-5 py-5 sm:px-6 sm:py-6 xl:grid-cols-2">
            <div className="space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-64 max-w-full" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
            <div className="space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-64 max-w-full" />
              <Skeleton className="h-8 w-40" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card shadow-sm">
          <div className="space-y-2 border-b border-border/70 px-5 py-4 sm:px-6">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-[32rem] max-w-full" />
          </div>
          <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
            <div className="space-y-3">
              <Skeleton className="h-5 w-28" />
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 w-full" />
                ))}
              </div>
            </div>
            <Skeleton className="h-px w-full" />
            <div className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <div className="grid gap-4 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-lg border p-4 space-y-3">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-4 w-40" />
                    <div className="grid gap-3">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <Skeleton key={j} className="h-20 w-full" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card shadow-sm">
          <div className="space-y-2 border-b border-border/70 px-5 py-4 sm:px-6">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
            <div className="space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-44" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-lg border p-4 space-y-2">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-3 w-36" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card shadow-sm">
          <div className="space-y-2 border-b border-border/70 px-5 py-4 sm:px-6">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-[36rem] max-w-full" />
          </div>
          <div className="space-y-3 px-5 py-5 sm:px-6 sm:py-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </PageScaffold>
    </div>
  );
}
