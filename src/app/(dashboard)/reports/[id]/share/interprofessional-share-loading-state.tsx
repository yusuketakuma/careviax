import { PageScaffold } from '@/components/layout/page-scaffold';
import { Skeleton } from '@/components/ui/loading';

export function InterprofessionalShareLoadingState() {
  return (
    <PageScaffold>
      <div
        className="space-y-6"
        role="status"
        aria-label="他職種共有ワークスペースを読み込み中"
        aria-live="polite"
      >
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          <section className="rounded-lg border border-border/70 bg-card p-4" aria-hidden="true">
            <Skeleton className="h-5 w-28" />
            <div className="mt-3 space-y-2.5">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border bg-background px-4 py-3"
                >
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="mt-2 h-3 w-36" />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border/70 bg-card p-4" aria-hidden="true">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3 w-44" />
            </div>
            <div className="mt-3 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border/70 bg-background px-4 py-3"
                >
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-5/6" />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border/70 bg-card p-4" aria-hidden="true">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-4 h-4 w-36" />
            <div className="mt-2.5 rounded-lg border border-border/70 bg-background px-4 py-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
              <Skeleton className="mt-3 h-3 w-40" />
            </div>
            <Skeleton className="mt-4 h-10 w-full rounded-md" />
            <Skeleton className="mt-3 h-10 w-full rounded-md" />
          </section>
        </div>
        <span className="sr-only">他職種共有ワークスペースを読み込み中</span>
      </div>
    </PageScaffold>
  );
}
