import { Loading, Spinner, Skeleton, SkeletonRows } from 'ph-os';

export function FullPage() {
  return (
    <div style={{ padding: 24, maxWidth: 520, border: '1px solid var(--border)', borderRadius: 8 }}>
      <Loading label="訪問記録を読み込み中..." />
    </div>
  );
}

export function Spinners() {
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', padding: 32 }}>
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <SkeletonRows rows={5} cols={4} />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div style={{ padding: 24, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
