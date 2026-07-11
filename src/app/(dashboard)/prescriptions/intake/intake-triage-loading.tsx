import { Skeleton, SkeletonRows } from '@/components/ui/loading';

export function IntakeTriageLoading() {
  return (
    <section
      className="space-y-4"
      role="status"
      aria-label="処方取込トリアージを読み込み中"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-11 w-36" />
      </div>

      <div className="space-y-4">
        <section className="rounded-lg border border-border/70 bg-card p-4" aria-hidden="true">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-64 max-w-full" />
            <div className="ml-auto flex gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-16" />
              ))}
            </div>
          </div>
          <div className="mt-3 max-h-[360px] overflow-hidden">
            <SkeletonRows rows={6} cols={7} status={false} />
          </div>
        </section>

        <section
          className="rounded-lg border border-border/70 bg-card px-4 py-3"
          aria-hidden="true"
        >
          <Skeleton className="h-5 w-52" />
          <Skeleton className="mt-2 h-4 w-full max-w-xl" />
        </section>

        <div className="grid gap-3 md:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-border/70 bg-card p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-3 h-16 w-full" />
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">処方取込トリアージを読み込み中</span>
    </section>
  );
}
