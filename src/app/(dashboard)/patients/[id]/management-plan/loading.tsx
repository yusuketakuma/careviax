import { Skeleton } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function PatientManagementPlanLoading() {
  return (
    <PageScaffold aria-label="管理計画を読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </PageScaffold>
  );
}
