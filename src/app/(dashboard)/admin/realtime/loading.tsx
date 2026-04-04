import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function AdminRealtimeLoading() {
  return (
    <PageScaffold aria-label="リアルタイム情報を読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </PageScaffold>
  );
}
