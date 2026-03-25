'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Clock, AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';

type CommunicationRequestRow = {
  id: string;
  request_type: string;
  subject: string;
  status: string;
  requested_at: string;
  due_date: string | null;
  patient_id: string | null;
  responses: Array<{
    id: string;
    responder_name: string;
    responded_at: string;
  }>;
};

const STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  sent: '送信済み',
  received: '受信済み',
  in_progress: '対応中',
  responded: '返信済み',
  closed: '完了',
  escalated: 'エスカレ',
  cancelled: '取消',
  expired: '期限切れ',
};

const STATUS_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  draft: 'outline',
  sent: 'secondary',
  received: 'secondary',
  in_progress: 'default',
  responded: 'default',
  closed: 'outline',
  escalated: 'destructive',
  cancelled: 'outline',
  expired: 'destructive',
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  inquiry: '疑義照会',
  tracing_report: 'トレーシングレポート',
  physician_inquiry: '医師照会',
  care_manager_inquiry: 'ケアマネ照会',
  other: 'その他',
};

const FILTER_TABS = [
  { value: '', label: 'すべて' },
  { value: 'sent', label: '返信待ち' },
  { value: 'in_progress', label: '対応中' },
  { value: 'responded', label: '返信済み' },
  { value: 'closed', label: '完了' },
];

export function CommunicationRequestsContent() {
  const orgId = useOrgId();
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['communication-requests', orgId, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(
        `/api/communication-requests?${params.toString()}`,
        { headers: { 'x-org-id': orgId } }
      );
      if (!res.ok) throw new Error('依頼一覧の取得に失敗しました');
      return res.json() as Promise<{
        data: CommunicationRequestRow[];
        hasMore: boolean;
      }>;
    },
    enabled: !!orgId,
  });

  const columns = useMemo<ColumnDef<CommunicationRequestRow>[]>(
    () => [
      {
        accessorKey: 'request_type',
        header: '依頼タイプ',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm">
            {REQUEST_TYPE_LABELS[row.original.request_type] ??
              row.original.request_type}
          </span>
        ),
      },
      {
        accessorKey: 'subject',
        header: '件名',
        cell: ({ row }) => (
          <span className="max-w-xs truncate text-sm font-medium">
            {row.original.subject}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'ステータス',
        cell: ({ row }) => {
          const s = row.original.status;
          return (
            <Badge variant={STATUS_VARIANTS[s] ?? 'outline'}>
              {STATUS_LABELS[s] ?? s}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'requested_at',
        header: '依頼日',
        cell: ({ row }) =>
          format(parseISO(row.original.requested_at), 'M/d HH:mm', {
            locale: ja,
          }),
      },
      {
        accessorKey: 'due_date',
        header: '期限',
        cell: ({ row }) => {
          const d = row.original.due_date;
          if (!d) return <span className="text-muted-foreground">—</span>;
          const isOverdue = new Date(d) < new Date();
          return (
            <span
              className={
                isOverdue
                  ? 'flex items-center gap-1 text-destructive'
                  : ''
              }
            >
              {isOverdue && (
                <AlertTriangle className="size-3" aria-hidden="true" />
              )}
              {format(parseISO(d), 'M/d', { locale: ja })}
            </span>
          );
        },
      },
      {
        id: 'last_response',
        header: '最終返信',
        cell: ({ row }) => {
          const r = row.original.responses[0];
          if (!r)
            return (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="size-3" aria-hidden="true" />
                未返信
              </span>
            );
          return (
            <span className="text-sm text-muted-foreground">
              {r.responder_name}{' '}
              {format(parseISO(r.responded_at), 'M/d', { locale: ja })}
            </span>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      {/* Status filter tabs */}
      <div className="flex gap-2 border-b border-border pb-3">
        {FILTER_TABS.map((tab) => (
          <Button
            key={tab.value}
            variant={statusFilter === tab.value ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        caption="依頼・照会一覧"
      />
    </div>
  );
}
