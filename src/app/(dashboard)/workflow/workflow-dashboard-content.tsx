'use client';

import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';

type WorkflowData = {
  cycle_status_counts: Record<string, number>;
  workflow_exceptions: { open: number };
  communication_requests: { pending: number; overdue: number };
  delivery: { failures: number };
  refill_upcoming: Array<{
    id: string;
    cycle_id: string;
    refill_remaining_count: number;
    prescribed_date: string;
    cycle: {
      patient_id: string;
      case_: { patient: { id: string; name: string } };
    };
  }>;
};

const CYCLE_STATUS_LABELS: Record<
  string,
  { label: string; color: string }
> = {
  intake_received: { label: '応需受付', color: 'bg-blue-100 text-blue-800' },
  structuring: { label: '構造化中', color: 'bg-blue-100 text-blue-800' },
  inquiry_pending: {
    label: '疑義照会中',
    color: 'bg-orange-100 text-orange-800',
  },
  inquiry_resolved: {
    label: '照会解決済',
    color: 'bg-green-100 text-green-800',
  },
  ready_to_dispense: {
    label: '調剤待ち',
    color: 'bg-blue-100 text-blue-800',
  },
  dispensing: { label: '調剤中', color: 'bg-green-100 text-green-800' },
  dispensed: { label: '調剤完了', color: 'bg-green-100 text-green-800' },
  audit_pending: {
    label: '鑑査待ち',
    color: 'bg-orange-100 text-orange-800',
  },
  audited: { label: '鑑査済み', color: 'bg-green-100 text-green-800' },
  setting: { label: 'セット中', color: 'bg-blue-100 text-blue-800' },
  set_audited: {
    label: 'セット鑑査済',
    color: 'bg-green-100 text-green-800',
  },
  visit_ready: { label: '訪問準備完了', color: 'bg-green-100 text-green-800' },
  visit_completed: {
    label: '訪問完了',
    color: 'bg-green-100 text-green-800',
  },
  on_hold: { label: '保留', color: 'bg-gray-100 text-gray-600' },
};

export function WorkflowDashboardContent() {
  const orgId = useOrgId();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-workflow', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/workflow', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ダッシュボードの取得に失敗しました');
      return res.json() as Promise<{ data: WorkflowData }>;
    },
    enabled: !!orgId,
    refetchInterval: 60_000, // refresh every minute
  });

  const workflow = data?.data;

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="h-24 animate-pulse rounded bg-muted" />
          </Card>
        ))}
      </div>
    );
  }

  const cycleStatusEntries = Object.entries(
    workflow?.cycle_status_counts ?? {}
  ).filter(([, count]) => count > 0);

  return (
    <div className="space-y-8">
      {/* Alert summary */}
      {((workflow?.workflow_exceptions.open ?? 0) > 0 ||
        (workflow?.communication_requests.overdue ?? 0) > 0 ||
        (workflow?.delivery.failures ?? 0) > 0) && (
        <div className="flex flex-wrap gap-3">
          {(workflow?.workflow_exceptions.open ?? 0) > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              ワークフロー例外{' '}
              <span className="font-bold">
                {workflow?.workflow_exceptions.open}
              </span>{' '}
              件未解消
            </div>
          )}
          {(workflow?.communication_requests.overdue ?? 0) > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">
              <Clock className="size-4" aria-hidden="true" />
              期限超過依頼{' '}
              <span className="font-bold">
                {workflow?.communication_requests.overdue}
              </span>{' '}
              件
            </div>
          )}
          {(workflow?.delivery.failures ?? 0) > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              <XCircle className="size-4" aria-hidden="true" />
              送付失敗{' '}
              <span className="font-bold">{workflow?.delivery.failures}</span>{' '}
              件
            </div>
          )}
        </div>
      )}

      {/* MedicationCycle status counts */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          処方サイクル工程別件数
        </h2>
        {cycleStatusEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            進行中のサイクルはありません
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {cycleStatusEntries.map(([status, count]) => {
              const config = CYCLE_STATUS_LABELS[status] ?? {
                label: status,
                color: 'bg-gray-100 text-gray-600',
              };
              return (
                <Card key={status} size="sm">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {config.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end justify-between">
                      <span className="text-3xl font-bold tabular-nums text-foreground">
                        {count}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.color}`}
                      >
                        件
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Communication & delivery summary */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          連携ダッシュボード
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                返信待ち依頼
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-3xl font-bold tabular-nums">
                {workflow?.communication_requests.pending ?? 0}
              </span>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                期限超過
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (workflow?.communication_requests.overdue ?? 0) > 0
                    ? 'text-destructive'
                    : ''
                }`}
              >
                {workflow?.communication_requests.overdue ?? 0}
              </span>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                送付失敗
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (workflow?.delivery.failures ?? 0) > 0
                    ? 'text-destructive'
                    : ''
                }`}
              >
                {workflow?.delivery.failures ?? 0}
              </span>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                例外未解消
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (workflow?.workflow_exceptions.open ?? 0) > 0
                    ? 'text-destructive'
                    : ''
                }`}
              >
                {workflow?.workflow_exceptions.open ?? 0}
              </span>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Refill upcoming */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          リフィル処方箋 — 次回調剤予定
        </h2>
        {(workflow?.refill_upcoming.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            リフィル処方箋の予定はありません
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    患者名
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    残回数
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    処方日
                  </th>
                </tr>
              </thead>
              <tbody>
                {workflow?.refill_upcoming.map((item, i) => (
                  <tr
                    key={item.id}
                    className={
                      i % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                    }
                  >
                    <td className="px-4 py-2 font-medium">
                      {item.cycle.case_.patient.name}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary">
                        残{item.refill_remaining_count}回
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {format(parseISO(item.prescribed_date), 'M/d', {
                        locale: ja,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          type="button"
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          更新
        </button>
      </div>
    </div>
  );
}
