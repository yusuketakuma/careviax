import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function AdminAnalyticsLoading() {
  return (
    <PageScaffold aria-label="アナリティクスを読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <SkeletonRows rows={6} cols={4} />
      </div>
    </PageScaffold>
  );
}
