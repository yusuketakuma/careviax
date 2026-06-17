import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { WorkbenchLoadingNav } from '@/components/features/dispense-workbench/workbench-loading-nav';

export default function SetLoading() {
  return (
    <PageScaffold aria-label="セットワークベンチを読み込み中">
      <WorkbenchLoadingNav phase="setp" />
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <SkeletonRows rows={6} cols={4} />
      </div>
    </PageScaffold>
  );
}
