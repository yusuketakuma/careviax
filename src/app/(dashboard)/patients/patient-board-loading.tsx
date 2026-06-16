import { Skeleton, SkeletonRows } from '@/components/ui/loading';

export function PatientBoardLoadingShell() {
  return (
    <div className="space-y-6" role="status" aria-label="患者一覧を読み込み中">
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-lg" />
          ))}
        </div>

        <div className="mt-4 border-t border-border/70 pt-3">
          <Skeleton className="h-9 w-full max-w-3xl rounded-lg" />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full rounded-lg" />
          ))}
        </div>
        <div className="space-y-4">
          <SkeletonRows rows={3} cols={1} status={false} />
        </div>
      </div>

      <span className="sr-only">
        患者一覧を読み込み中です。患者情報の判断には使用しないでください。
      </span>
    </div>
  );
}
