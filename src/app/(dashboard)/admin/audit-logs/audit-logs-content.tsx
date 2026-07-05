'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO, subDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Download, Search, Filter, Info, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AUDIT_LOG_ACTION_LABEL_MAP,
  AUDIT_LOG_ACTION_OPTIONS,
  AUDIT_LOG_REDACTION_STATE_LABEL_MAP,
  AUDIT_LOG_RISK_TIER_OPTIONS,
  AUDIT_LOG_TARGET_TYPE_OPTIONS,
} from '@/lib/audit-logs/filter-options';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';

// --- Types ---

type AuditLog = {
  id: string;
  actor_id: string;
  actor_name?: string;
  action: string;
  target_type: string;
  target_id: string;
  risk_tier: 'high' | 'standard';
  risk_label: string;
  redaction_state: 'redacted' | 'minimized' | 'not_applicable';
  ip_address: string | null;
  created_at: string;
};

// --- Helpers ---

// 監査操作の種別を 6 軸セマンティックトークンへ写像する。
// 削除/取消=blocked(赤) / 作成=done(緑) / 承認=info(青) / 差戻し・訂正=confirm(橙) /
// 出力=info(青) / その他=readonly(灰)。色だけに頼らずラベル(actionLabel)を併記する。
function actionBadgeClass(action: string): string {
  if (action.includes('delete') || action.includes('revoked')) {
    return 'bg-state-blocked/10 text-state-blocked border-transparent';
  }
  if (action.includes('create') || action.includes('created') || action.includes('registered')) {
    return 'bg-state-done/10 text-state-done border-transparent';
  }
  if (action.includes('approve') || action.includes('activated')) {
    return 'bg-tag-info/10 text-tag-info border-transparent';
  }
  if (action.includes('reject') || action.includes('correction')) {
    return 'bg-state-confirm/10 text-state-confirm border-transparent';
  }
  if (action.includes('export') || action.includes('download')) {
    return 'bg-tag-info/10 text-tag-info border-transparent';
  }
  return 'bg-state-readonly/10 text-state-readonly border-transparent';
}

function actionLabel(action: string): string {
  return (AUDIT_LOG_ACTION_LABEL_MAP as Record<string, string>)[action] ?? action;
}

function riskBadgeClass(riskTier: AuditLog['risk_tier']): string {
  return riskTier === 'high'
    ? 'bg-state-blocked/10 text-state-blocked border-state-blocked/30'
    : 'bg-state-readonly/10 text-state-readonly border-transparent';
}

function redactionBadgeClass(redactionState: AuditLog['redaction_state']): string {
  if (redactionState === 'redacted') {
    return 'bg-state-confirm/10 text-state-confirm border-state-confirm/30';
  }
  if (redactionState === 'minimized') {
    return 'bg-tag-info/10 text-tag-info border-tag-info/30';
  }
  return 'bg-state-readonly/10 text-state-readonly border-transparent';
}

// 一覧の表示上限(新しい順)。これに到達したら全件誤認を避ける注記を出す。
const RESULT_LIMIT = 100;

// --- Main ---

export function AuditLogsContent() {
  const orgId = useOrgId();
  const [actorFilter, setActorFilter] = useState('');
  const [riskTierFilter, setRiskTierFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const queryParams = new URLSearchParams({
    limit: String(RESULT_LIMIT),
    ...(actorFilter ? { actor: actorFilter } : {}),
    ...(riskTierFilter ? { risk_tier: riskTierFilter } : {}),
    ...(targetTypeFilter ? { target_type: targetTypeFilter } : {}),
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [
      'audit-logs',
      orgId,
      actorFilter,
      riskTierFilter,
      targetTypeFilter,
      actionFilter,
      dateFrom,
      dateTo,
    ],
    queryFn: async () => {
      const res = await fetch(`/api/audit-logs?${queryParams}`, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: AuditLog[] }>(res, '監査ログの取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const logs = data?.data ?? [];
  // 表示上限に到達 = さらに古いログが存在しうる(API は total/has_more を返さない)。
  const isCapped = logs.length >= RESULT_LIMIT;

  const columns = useMemo<ColumnDef<AuditLog>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: '日時',
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {format(parseISO(row.original.created_at), 'MM/dd HH:mm:ss', { locale: ja })}
          </span>
        ),
      },
      {
        accessorKey: 'risk_tier',
        header: 'リスク',
        cell: ({ row }) => (
          <Badge variant="outline" className={`text-xs ${riskBadgeClass(row.original.risk_tier)}`}>
            {row.original.risk_label}
          </Badge>
        ),
      },
      {
        id: 'actor',
        header: '操作者',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.actor_name ?? row.original.actor_id}</span>
        ),
      },
      {
        accessorKey: 'action',
        header: '操作',
        cell: ({ row }) => (
          <Badge variant="outline" className={`text-xs ${actionBadgeClass(row.original.action)}`}>
            {actionLabel(row.original.action)}
          </Badge>
        ),
      },
      {
        accessorKey: 'target_type',
        header: '対象種別',
        cell: ({ row }) => {
          const opt = AUDIT_LOG_TARGET_TYPE_OPTIONS.find(
            (o) => o.value === row.original.target_type,
          );
          return (
            <span className="text-sm text-muted-foreground">
              {opt?.label ?? row.original.target_type}
            </span>
          );
        },
      },
      {
        accessorKey: 'target_id',
        header: '対象ID',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.target_id}</span>
        ),
      },
      {
        accessorKey: 'redaction_state',
        header: 'Redaction',
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={`text-xs ${redactionBadgeClass(row.original.redaction_state)}`}
          >
            {AUDIT_LOG_REDACTION_STATE_LABEL_MAP[row.original.redaction_state]}
          </Badge>
        ),
      },
      {
        accessorKey: 'ip_address',
        header: 'IPアドレス',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.ip_address ?? '—'}
          </span>
        ),
      },
    ],
    [],
  );

  async function handleExport(format: 'csv' | 'json') {
    try {
      const exportParams = new URLSearchParams(queryParams);
      exportParams.set('format', format);
      const response = await fetch(`/api/audit-logs/export?${exportParams.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) {
        await readApiJson<never>(response, '監査ログのエクスポートに失敗しました');
        throw new Error('監査ログのエクスポートに失敗しました');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('content-disposition');
      const fallbackName = `audit-logs.${format}`;
      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ??
        disposition?.match(/filename=([^;]+)/)?.[1]?.trim() ??
        fallbackName;
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success(`監査ログを${format.toUpperCase()}形式で出力しました`);
    } catch (error) {
      const message = messageFromError(error, '監査ログのエクスポートに失敗しました');
      toast.error(message);
    }
  }

  return (
    <div className="space-y-4">
      <PageSection
        title="監査ログ一覧"
        description="現在の絞り込み条件に一致する監査ログを確認し、同じ条件で JSON または CSV に出力します。"
        tone="subtle"
        actions={
          <ActionRail>
            <Button
              size="sm"
              variant="outline"
              className="h-11 sm:h-11 sm:min-h-[44px]"
              onClick={() => void handleExport('json')}
            >
              <Download className="mr-1.5 size-3.5" aria-hidden="true" />
              JSON出力
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-11 sm:h-11 sm:min-h-[44px]"
              onClick={() => void handleExport('csv')}
            >
              <Download className="mr-1.5 size-3.5" aria-hidden="true" />
              CSV出力
            </Button>
          </ActionRail>
        }
      >
        <div className="space-y-4">
          <FilterSummaryBar
            items={[
              {
                label: '表示件数',
                value: isCapped ? `直近${RESULT_LIMIT}件（表示上限）` : `${logs.length}件`,
              },
              { label: '期間', value: `${dateFrom || '未指定'} - ${dateTo || '未指定'}` },
              {
                label: 'リスク',
                value:
                  AUDIT_LOG_RISK_TIER_OPTIONS.find((opt) => opt.value === riskTierFilter)?.label ??
                  'すべて',
              },
              {
                label: '対象種別',
                value:
                  AUDIT_LOG_TARGET_TYPE_OPTIONS.find((opt) => opt.value === targetTypeFilter)
                    ?.label ?? 'すべて',
              },
              {
                label: '操作',
                value:
                  AUDIT_LOG_ACTION_OPTIONS.find((opt) => opt.value === actionFilter)?.label ??
                  'すべて',
              },
              ...(actorFilter ? [{ label: '操作者', value: actorFilter }] : []),
            ]}
          />
          {isCapped && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
              data-testid="audit-logs-cap-notice"
            >
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p>
                一覧は新しい順に直近{RESULT_LIMIT}件まで表示しています。同じ条件の詳細確認は CSV /
                JSON 出力を利用してください。
              </p>
            </div>
          )}
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/35 px-4 py-3 text-sm text-muted-foreground"
            data-testid="audit-logs-risk-notice"
          >
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-state-confirm" />
            <p>
              高リスク操作は優先レビュー対象です。CSV / JSON 出力にも risk_tier と redaction_state
              を含めます。
            </p>
          </div>
          <details className="rounded-md border border-border bg-surface-subtle/60 [&:not([open])>div]:hidden">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
              表示条件を変更
              <Filter className="size-4 text-muted-foreground" aria-hidden="true" />
            </summary>
            <div className="grid gap-4 border-t border-border px-4 py-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div className="space-y-1.5">
                <Label htmlFor="actor-filter">操作者</Label>
                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="actor-filter"
                    value={actorFilter}
                    onChange={(e) => setActorFilter(e.target.value)}
                    placeholder="ユーザーIDで検索"
                    className="h-11 pl-8 sm:h-11 sm:min-h-[44px]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="risk-tier-filter">リスク</Label>
                <Select value={riskTierFilter} onValueChange={(v) => setRiskTierFilter(v ?? '')}>
                  <SelectTrigger id="risk-tier-filter" className="h-11 sm:h-11 sm:min-h-[44px]">
                    <SelectValue placeholder="すべて" />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIT_LOG_RISK_TIER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value || 'all'} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="target-type-filter">対象種別</Label>
                <Select
                  value={targetTypeFilter}
                  onValueChange={(v) => setTargetTypeFilter(v ?? '')}
                >
                  <SelectTrigger id="target-type-filter" className="h-11 sm:h-11 sm:min-h-[44px]">
                    <SelectValue placeholder="すべて" />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIT_LOG_TARGET_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="action-filter">操作</Label>
                <Select
                  value={actionFilter}
                  onValueChange={(value) => setActionFilter(value ?? '')}
                >
                  <SelectTrigger id="action-filter" className="h-11 sm:h-11 sm:min-h-[44px]">
                    <SelectValue placeholder="すべて" />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIT_LOG_ACTION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value || 'all'} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="date-from">開始日</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-11 sm:h-11 sm:min-h-[44px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="date-to">終了日</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-11 sm:h-11 sm:min-h-[44px]"
                />
              </div>
            </div>
          </details>
          {isError ? (
            // 取得失敗を「ログがありません」(空)に見せない。監査ログは安全証跡のため
            // 失敗と空を明確に分離し、再試行導線を出す。
            <ErrorState
              variant="server"
              title="監査ログを取得できませんでした"
              description="時間をおいて再試行してください。解消しない場合は管理者に連絡してください。"
              onRetry={() => refetch()}
            />
          ) : !isLoading && logs.length === 0 ? (
            <EmptyState
              icon={Filter}
              title="ログがありません"
              description="フィルタ条件を変更するか、期間を広げてください。"
            />
          ) : (
            <DataTable columns={columns} data={logs} isLoading={isLoading} caption="監査ログ一覧" />
          )}
        </div>
      </PageSection>
    </div>
  );
}
