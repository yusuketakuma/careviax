'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO, subDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Download, Search, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
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

// --- Sample data ---

const SAMPLE_LOGS: AuditLog[] = [
  { id: '1', actor_id: 'u1', actor_name: '鈴木薬剤師', action: 'create', target_type: 'visit_record', target_id: 'vr_001', ip_address: '192.168.1.10', created_at: '2026-03-26T09:30:00Z' },
  { id: '2', actor_id: 'u2', actor_name: '田中管理者', action: 'update', target_type: 'patient', target_id: 'p_001', ip_address: '192.168.1.11', created_at: '2026-03-26T08:15:00Z' },
  { id: '3', actor_id: 'u1', actor_name: '鈴木薬剤師', action: 'export', target_type: 'prescription', target_id: 'rx_042', ip_address: '192.168.1.10', created_at: '2026-03-25T16:45:00Z' },
  { id: '4', actor_id: 'u3', actor_name: '山本薬剤師', action: 'approve', target_type: 'dispense', target_id: 'disp_011', ip_address: '192.168.1.12', created_at: '2026-03-25T14:00:00Z' },
  { id: '5', actor_id: 'u2', actor_name: '田中管理者', action: 'login', target_type: 'user', target_id: 'u2', ip_address: '192.168.1.11', created_at: '2026-03-25T08:00:00Z' },
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
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const queryParams = new URLSearchParams({
    limit: '100',
    ...(actorFilter ? { actor: actorFilter } : {}),
    ...(targetTypeFilter ? { target_type: targetTypeFilter } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', orgId, actorFilter, targetTypeFilter, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/audit-logs?${queryParams}`, {
        headers: { 'x-org-id': orgId },
      });
      if (res.status === 404) return { data: SAMPLE_LOGS };
      if (!res.ok) throw new Error('監査ログの取得に失敗しました');
      return res.json() as Promise<{ data: AuditLog[] }>;
    },
    enabled: !!orgId,
  });

  const logs = data?.data ?? SAMPLE_LOGS;

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

  function handleExport() {
    toast.success('監査ログのCSVエクスポートを開始しました（Phase 2 実装予定）');
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="actor-filter">操作者</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="actor-filter"
                  value={actorFilter}
                  onChange={(e) => setActorFilter(e.target.value)}
                  placeholder="名前で検索"
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
        <Button size="sm" variant="outline" onClick={handleExport}>
          <Download className="mr-1.5 size-3.5" aria-hidden="true" />
          CSV出力
        </Button>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={logs}
        isLoading={isLoading}
        caption="監査ログ一覧"
      />
    </div>
  );
}
