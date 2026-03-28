import { Skeleton, SkeletonRows } from '@/components/ui/loading';

export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-6" aria-label="ページを読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <SkeletonRows rows={6} cols={4} />
      </div>
    </div>
  );
}
