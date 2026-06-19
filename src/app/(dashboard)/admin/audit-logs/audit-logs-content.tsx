'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO, subDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Download, Search, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
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
  AUDIT_LOG_TARGET_TYPE_OPTIONS,
} from '@/lib/audit-logs/filter-options';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type AuditLog = {
  id: string;
  actor_id: string;
  actor_name?: string;
  action: string;
  target_type: string;
  target_id: string;
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

// --- Main ---

export function AuditLogsContent() {
  const orgId = useOrgId();
  const [actorFilter, setActorFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const queryParams = new URLSearchParams({
    limit: '100',
    ...(actorFilter ? { actor: actorFilter } : {}),
    ...(targetTypeFilter ? { target_type: targetTypeFilter } : {}),
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', orgId, actorFilter, targetTypeFilter, actionFilter, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/audit-logs?${queryParams}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('監査ログの取得に失敗しました');
      return res.json() as Promise<{ data: AuditLog[] }>;
    },
    enabled: !!orgId,
  });

  const logs = data?.data ?? [];

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
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? '監査ログのエクスポートに失敗しました');
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
      const message =
        error instanceof Error ? error.message : '監査ログのエクスポートに失敗しました';
      toast.error(message);
    }
  }

  return (
    <div className="space-y-4">
      <PageSection
        title="絞り込み"
        description="操作者、対象、操作、期間を指定し、監査ログ一覧と出力対象を同じ条件に揃えます。"
        tone="subtle"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="actor-filter">操作者</Label>
            <div className="relative">
              <Search
                className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="actor-filter"
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                placeholder="ユーザーIDで検索"
                className="pl-8"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="target-type-filter">対象種別</Label>
            <Select value={targetTypeFilter} onValueChange={(v) => setTargetTypeFilter(v ?? '')}>
              <SelectTrigger id="target-type-filter">
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
            <Select value={actionFilter} onValueChange={(value) => setActionFilter(value ?? '')}>
              <SelectTrigger id="action-filter">
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
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date-to">終了日</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </PageSection>

      <PageSection
        title="監査ログ一覧"
        description="現在の絞り込み条件に一致する監査ログを確認し、同じ条件で JSON または CSV に出力します。"
        tone="subtle"
        actions={
          <ActionRail>
            <Button size="sm" variant="outline" onClick={() => void handleExport('json')}>
              <Download className="mr-1.5 size-3.5" aria-hidden="true" />
              JSON出力
            </Button>
            <Button size="sm" variant="outline" onClick={() => void handleExport('csv')}>
              <Download className="mr-1.5 size-3.5" aria-hidden="true" />
              CSV出力
            </Button>
          </ActionRail>
        }
      >
        <div className="space-y-4">
          <FilterSummaryBar
            items={[
              { label: '表示件数', value: `${logs.length}件` },
              { label: '期間', value: `${dateFrom || '未指定'} - ${dateTo || '未指定'}` },
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
          {!isLoading && logs.length === 0 ? (
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
