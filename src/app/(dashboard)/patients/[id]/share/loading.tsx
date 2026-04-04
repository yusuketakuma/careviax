import { Skeleton } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function PatientShareLoading() {
  return (
    <PageScaffold aria-label="外部共有を読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </PageScaffold>
  );
}
