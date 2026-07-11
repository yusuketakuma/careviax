import { Skeleton, SkeletonRows } from '@/components/ui/loading';

export default function PlatformLoading() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="プラットフォームコンソールを読み込み中"
      aria-live="polite"
    >
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-3xl" />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <SkeletonRows rows={6} cols={5} status={false} />
      </div>
      <span className="sr-only">プラットフォームコンソールを読み込み中</span>
    </div>
  );
}
