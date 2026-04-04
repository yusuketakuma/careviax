import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function AdminAuditLogsLoading() {
  return (
    <PageScaffold aria-label="監査ログを読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <SkeletonRows rows={8} cols={5} />
      </div>
    </PageScaffold>
  );
}
