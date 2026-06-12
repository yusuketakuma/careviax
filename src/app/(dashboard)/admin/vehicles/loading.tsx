import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function AdminVehiclesLoading() {
  return (
    <PageScaffold variant="bare" aria-label="車両マスターを読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="rounded-xl border border-border bg-card p-4">
          <SkeletonRows rows={7} cols={1} />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <SkeletonRows rows={8} cols={1} />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <SkeletonRows rows={6} cols={2} />
        </div>
      </div>
    </PageScaffold>
  );
}
