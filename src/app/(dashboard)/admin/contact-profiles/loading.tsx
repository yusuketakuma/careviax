import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function AdminContactProfilesLoading() {
  return (
    <PageScaffold aria-label="連絡先プロファイルを読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <SkeletonRows rows={6} cols={4} />
      </div>
    </PageScaffold>
  );
}
