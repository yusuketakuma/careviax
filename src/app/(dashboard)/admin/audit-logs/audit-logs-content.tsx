'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO, subDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Download, Search, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

// --- Constants ---

const TARGET_TYPE_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'patient', label: '患者' },
  { value: 'prescription', label: '処方箋' },
  { value: 'dispense', label: '調剤' },
  { value: 'visit_record', label: '訪問記録' },
  { value: 'user', label: 'ユーザー' },
  { value: 'setting', label: '設定' },
];

const ACTION_LABEL_MAP: Record<string, string> = {
  create: '作成',
  update: '更新',
  delete: '削除',
  read: '閲覧',
  login: 'ログイン',
  logout: 'ログアウト',
  export: 'エクスポート',
  approve: '承認',
  reject: '差戻し',
};

const ACTION_OPTIONS = [
  { value: '', label: 'すべて' },
  ...Object.entries(ACTION_LABEL_MAP).map(([value, label]) => ({ value, label })),
];

// --- Helpers ---

function actionBadgeClass(action: string): string {
  switch (action) {
    case 'delete': return 'bg-red-100 text-red-800 border-red-200';
    case 'create': return 'bg-green-100 text-green-800 border-green-200';
    case 'approve': return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'reject': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'export': return 'bg-purple-100 text-purple-800 border-purple-200';
    default: return 'bg-gray-100 text-gray-700 border-gray-200';
  }
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
          <Badge
            variant="outline"
            className={`text-xs ${actionBadgeClass(row.original.action)}`}
          >
            {ACTION_LABEL_MAP[row.original.action] ?? row.original.action}
          </Badge>
        ),
      },
      {
        accessorKey: 'target_type',
        header: '対象種別',
        cell: ({ row }) => {
          const opt = TARGET_TYPE_OPTIONS.find((o) => o.value === row.original.target_type);
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
    []
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
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="size-4" aria-hidden="true" />
            フィルタ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="actor-filter">操作者</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
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
              <Select
                value={targetTypeFilter}
                onValueChange={(v) => setTargetTypeFilter(v ?? '')}
              >
                <SelectTrigger id="target-type-filter">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_TYPE_OPTIONS.map((opt) => (
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
                  {ACTION_OPTIONS.map((opt) => (
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
        </CardContent>
      </Card>

      {/* Export + count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{logs.length}件</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleExport('json')}>
            <Download className="mr-1.5 size-3.5" aria-hidden="true" />
            JSON出力
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handleExport('csv')}>
            <Download className="mr-1.5 size-3.5" aria-hidden="true" />
            CSV出力
          </Button>
        </div>
      </div>

      {/* Table */}
      {!isLoading && logs.length === 0 ? (
        <EmptyState
          icon={Filter}
          title="ログがありません"
          description="フィルタ条件を変更するか、期間を広げてください。"
        />
      ) : (
        <DataTable
          columns={columns}
          data={logs}
          isLoading={isLoading}
          caption="監査ログ一覧"
        />
      )}
    </div>
  );
}
