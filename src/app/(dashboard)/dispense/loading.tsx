import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function DispenseLoading() {
  return (
    <PageScaffold aria-label="調剤キューを読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <SkeletonRows rows={8} cols={4} />
      </div>
    </PageScaffold>
  );
}
