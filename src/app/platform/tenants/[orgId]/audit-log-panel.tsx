'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ScrollText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
import { PlatformApiError, platformFetchJson } from '../../platform-fetch';

type BreakGlassAuditEntry = {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  changes: unknown;
  ip_address: string | null;
  created_at: string;
};

type AuditResponse = { entries: BreakGlassAuditEntry[]; truncated: boolean };

const ACTION_LABEL: Record<string, string> = {
  break_glass_activate: '起動',
  break_glass_revoke: '終了',
  break_glass_read: '閲覧',
  break_glass_write: '変更',
};

const ACTION_ROLE: Record<string, StatusRole> = {
  break_glass_activate: 'info',
  break_glass_revoke: 'blocked',
  break_glass_read: 'readonly',
  break_glass_write: 'hazard',
};

function extractReason(changes: unknown): string | null {
  if (!changes || typeof changes !== 'object') return null;
  const reason = (changes as Record<string, unknown>).reason;
  return typeof reason === 'string' ? reason : null;
}

export function AuditLogPanel({ orgId }: { orgId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['platform-tenant-audit', orgId],
    queryFn: () => platformFetchJson<AuditResponse>(`/api/platform/tenants/${orgId}/audit`),
  });

  const isForbidden = error instanceof PlatformApiError && error.status === 403;

  const columns: ColumnDef<BreakGlassAuditEntry>[] = [
    {
      accessorKey: 'created_at',
      header: '日時',
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {format(parseISO(row.original.created_at), 'yyyy/MM/dd HH:mm:ss', { locale: ja })}
        </span>
      ),
    },
    {
      accessorKey: 'action',
      header: '操作',
      cell: ({ row }) => (
        <StateBadge role={ACTION_ROLE[row.original.action] ?? 'readonly'}>
          {ACTION_LABEL[row.original.action] ?? row.original.action}
        </StateBadge>
      ),
    },
    {
      accessorKey: 'actor_id',
      header: '操作者',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.actor_id}</span>,
    },
    {
      id: 'target',
      header: '対象',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.target_type}
          {row.original.target_id ? `: ${row.original.target_id}` : ''}
        </span>
      ),
    },
    {
      id: 'reason',
      header: '理由',
      cell: ({ row }) => (
        <span className="text-sm break-words">{extractReason(row.original.changes) ?? '—'}</span>
      ),
      meta: { tabletHidden: true },
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="size-4" aria-hidden="true" />
          アクセス監査ログ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isForbidden ? (
          <ErrorState
            variant="forbidden"
            title="監査ログを表示できません"
            description="このテナントの有効なブレークグラスセッションがありません。上のフォームからアクセスを起動してください。"
          />
        ) : isError ? (
          <ErrorState
            variant="server"
            title="監査ログを取得できませんでした"
            description="時間をおいて再試行してください。"
            action={{ label: '再試行', onClick: () => refetch() }}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={data?.entries ?? []}
              isLoading={isLoading}
              caption="ブレークグラスアクセス監査ログ"
              emptyMessage="このテナントへのブレークグラスアクセス履歴はまだありません"
            />
            {data?.truncated ? (
              <p className="text-xs text-muted-foreground">
                直近の履歴のみ表示しています。すべての履歴が必要な場合はエクスポート機能の追加を検討してください。
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
