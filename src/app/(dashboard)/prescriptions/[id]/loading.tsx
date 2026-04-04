import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function PrescriptionDetailLoading() {
  return (
    <PageScaffold aria-label="処方詳細を読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <SkeletonRows rows={4} cols={4} />
      </div>
    </PageScaffold>
  );
}
