import { Skeleton } from '@/components/ui/loading';

export default function DashboardLoading() {
  return (
    <main className="px-6 py-4" aria-label="ダッシュボード読み込み中">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-11 w-24 rounded-md" />
          <Skeleton className="h-11 w-40 rounded-md" />
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <Skeleton className="h-14 w-full rounded-lg" />

        <section className="rounded-lg border border-border/70 bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-60 max-w-full" />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-36 w-full rounded-lg" />
            ))}
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <section className="rounded-lg border border-border/70 bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
              {Array.from({ length: 9 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full rounded-md" />
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-border/70 bg-card p-4">
            <Skeleton className="h-5 w-28" />
            <div className="mt-3 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full rounded-md" />
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-border/70 bg-card p-4">
          <div className="grid gap-4 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-3">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
