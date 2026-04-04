import { Skeleton } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function MyDayLoading() {
  return (
    <PageScaffold aria-label="My Day を読み込み中">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </PageScaffold>
  );
}
