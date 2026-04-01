'use client';

import Link from 'next/link';
import { ArrowRight, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { DashboardActionsResponse, ActionItem } from '@/types/dashboard-home';

export async function fetchActions(orgId: string): Promise<DashboardActionsResponse> {
  const res = await fetch('/api/dashboard/home/actions', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('アクション取得に失敗しました');
  const json = await res.json();
  return json.data;
}

export const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  normal: 'bg-blue-100 text-blue-800',
  low: 'bg-gray-100 text-gray-600',
};

function PipelineBar({
  pipeline,
}: {
  pipeline: DashboardActionsResponse['pipeline'];
}) {
  const total = pipeline.reduce((s, p) => s + p.count, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>ワークフローパイプライン</span>
        <span className="font-medium text-foreground">{total}件</span>
      </div>
      <div className="grid auto-cols-fr grid-flow-col gap-1.5">
        {pipeline.map((step) => {
          const isActive = step.count > 0;
          return (
            <div
              key={step.key}
              className={[
                'flex flex-col items-center gap-1.5 rounded-md border px-1 py-2 text-center transition-colors',
                isActive
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-transparent bg-muted/50',
              ].join(' ')}
            >
              <span
                className={[
                  'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                {step.count}
              </span>
              <span
                className={[
                  'text-[11px] leading-tight',
                  isActive ? 'font-medium text-blue-900' : 'text-muted-foreground',
                ].join(' ')}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActionItemRow({ item }: { item: ActionItem }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={PRIORITY_STYLES[item.priority] ?? ''}
          >
            {item.queue_label}
          </Badge>
          {item.patient_name && (
            <span className="truncate text-xs text-muted-foreground">
              {item.patient_name}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">
          {item.title}
        </p>
      </div>
      <Link
        href={item.action_href}
        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {item.action_label}
        <ArrowRight className="size-3" aria-hidden="true" />
      </Link>
    </li>
  );
}

function ActionsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="アクション読み込み中">
      <div className="flex gap-0.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-3 w-6" />
            <Skeleton className="h-3 w-4" />
          </div>
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function ActionsSection() {
  const orgId = useOrgId();
  const { data, error, isError, isLoading, refetch } = useRealtimeQuery({
    queryKey: ['dashboard', 'actions', orgId],
    queryFn: () => fetchActions(orgId),
    staleTime: 30_000,
    enabled: !!orgId,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4" aria-hidden="true" />
            パイプライン & アクション
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActionsSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4" aria-hidden="true" />
            パイプライン & アクション
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState
            variant="server"
            title="アクションを取得できません"
            description="ホーム用アクション API の取得に失敗しました。再試行してください。"
            detail={error instanceof Error ? error.message : undefined}
            action={{ label: '再試行', onClick: () => void refetch() }}
          />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4" aria-hidden="true" />
          パイプライン & アクション
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <PipelineBar pipeline={data.pipeline} />

        {data.actions.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="対応が必要なアクションはありません"
            description="タスクや連絡が発生すると、ここに優先度順で表示されます。"
            className="border-0 px-0 py-4"
          />
        ) : (
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              要対応（{data.actions.length}件）
            </h3>
            <ul className="divide-y divide-border rounded-lg border" role="list">
              {data.actions.map((item) => (
                <ActionItemRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
