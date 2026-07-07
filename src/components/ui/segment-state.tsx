import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SkeletonRows } from '@/components/ui/loading';
import type { StateHeadingLevel } from '@/components/ui/state-elements';
import { cn } from '@/lib/utils';

type SegmentMetadata = {
  requestId?: string | null;
  route?: string | null;
  generatedAt?: string | null;
  retryCount?: number | null;
};

type SegmentStateSize = 'compact' | 'default';

const ID_LIKE_SEGMENT_PATTERN =
  /^(?:[0-9]+|[0-9a-f]{8,}(?:-[0-9a-f]{4,}){0,}|[A-Za-z]+_[A-Za-z0-9_-]+)$/;

export function sanitizeSegmentRoute(route: string): string {
  const [pathOnly = ''] = route.split(/[?#]/, 1);
  return pathOnly
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      return ID_LIKE_SEGMENT_PATTERN.test(segment) ? ':id' : segment;
    })
    .join('/');
}

function buildMetadataRows({ requestId, route, generatedAt, retryCount }: SegmentMetadata) {
  return [
    requestId ? ['request_id', requestId] : null,
    route ? ['route', sanitizeSegmentRoute(route)] : null,
    generatedAt ? ['generated_at', generatedAt] : null,
    retryCount != null ? ['retry_count', String(retryCount)] : null,
  ].filter((row): row is [string, string] => Boolean(row));
}

function SegmentMetadataList(metadata: SegmentMetadata) {
  const rows = buildMetadataRows(metadata);
  if (rows.length === 0) return null;

  return (
    <dl className="grid gap-x-3 gap-y-1 text-left sm:grid-cols-[max-content,minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-medium text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-all font-mono text-muted-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SegmentRetryButton({
  onRetry,
  label = '再読み込み',
  size = 'sm',
  className,
}: {
  onRetry: () => void;
  label?: string;
  size?: 'default' | 'sm';
  className?: string;
}) {
  return (
    <Button type="button" variant="outline" size={size} className={className} onClick={onRetry}>
      <RefreshCw className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}

export function SegmentLoading({
  label = 'セクションを読み込み中',
  description,
  rows = 3,
  cols = 3,
  size = 'default',
  className,
}: {
  label?: string;
  description?: string;
  rows?: number;
  cols?: number;
  size?: SegmentStateSize;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-dashed border-border bg-card/70',
        size === 'compact' ? 'p-3' : 'p-4',
        className,
      )}
      role="status"
      aria-label={label}
      aria-live="polite"
    >
      <div className="mb-3 space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <SkeletonRows rows={rows} cols={cols} status={false} />
    </div>
  );
}

export function SegmentError({
  title = 'このセクションを表示できません',
  cause = 'データを取得できませんでした。',
  nextAction = '通信状態を確認して再試行してください。',
  onRetry,
  retryLabel = '再読み込み',
  metadata,
  detail,
  headingLevel,
  className,
}: {
  title?: string;
  cause?: string;
  nextAction?: string;
  onRetry?: () => void;
  retryLabel?: string;
  metadata?: SegmentMetadata;
  detail?: ReactNode;
  headingLevel?: StateHeadingLevel;
  className?: string;
}) {
  const metadataDetail = metadata ? <SegmentMetadataList {...metadata} /> : null;

  return (
    <ErrorState
      variant="server"
      title={title}
      cause={cause}
      nextAction={nextAction}
      headingLevel={headingLevel}
      detail={
        detail || metadataDetail ? (
          <div className="space-y-2">
            {detail}
            {metadataDetail}
          </div>
        ) : undefined
      }
      onRetry={onRetry}
      retryLabel={retryLabel}
      retryVariant="outline"
      retrySize="sm"
      className={className}
    />
  );
}

export function SegmentStaleBanner({
  title = '前回取得時点の情報を表示中',
  description = '最新情報を取得できませんでした。必要に応じて再読み込みしてください。',
  metadata,
  onRetry,
  retryLabel = '再読み込み',
  className,
}: {
  title?: string;
  description?: string;
  metadata?: SegmentMetadata;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <Alert
      role="status"
      aria-live="polite"
      className={cn('items-start border-state-confirm/40 bg-state-confirm/5', className)}
    >
      <AlertTriangle className="mt-0.5 size-4 text-state-confirm" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{description}</p>
        {metadata ? <SegmentMetadataList {...metadata} /> : null}
      </AlertDescription>
      {onRetry ? (
        <AlertAction>
          <SegmentRetryButton onRetry={onRetry} label={retryLabel} />
        </AlertAction>
      ) : null}
    </Alert>
  );
}

export function SegmentEmptyButNotError({
  title,
  description,
  guidance = '取得は完了しています。条件を変更するか、次の入力を追加してください。',
  action,
  className,
}: {
  title: string;
  description?: string;
  guidance?: string;
  action?: Parameters<typeof EmptyState>[0]['action'];
  className?: string;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      guidance={guidance}
      action={action}
      className={className}
    />
  );
}
