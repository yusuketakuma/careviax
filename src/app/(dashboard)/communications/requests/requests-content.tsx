'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Clock, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { toast } from 'sonner';

type CommunicationRequestRow = {
  id: string;
  request_type: string;
  subject: string;
  status: string;
  requested_at: string;
  due_date: string | null;
  patient_id: string | null;
  recipient_name: string | null;
  recipient_role: string | null;
  responses: Array<{
    id: string;
    responder_name: string;
    responded_at: string;
  }>;
};

type CommunicationEventRow = {
  id: string;
  event_type: string;
  channel: string;
  direction: string;
  counterpart_name: string | null;
  subject: string | null;
  content: string | null;
  occurred_at: string;
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

const EVENT_TYPE_LABELS: Record<string, string> = {
  schedule_change: '訪問予定変更',
  physician_report: '主治医報告',
  care_manager_report: 'ケアマネ報告',
  tracing_report: 'トレーシングレポート送付',
  delivery_failure: '送達失敗',
  resend: '再送',
};

const FILTER_TABS = [
  { value: '', label: 'すべて' },
  { value: 'draft', label: '下書き' },
  { value: 'sent', label: '返信待ち' },
  { value: 'received', label: '受信済み' },
  { value: 'in_progress', label: '対応中' },
  { value: 'responded', label: '返信済み' },
  { value: 'escalated', label: 'エスカレ' },
  { value: 'closed', label: '完了' },
];

const DEFAULT_RESPONSE_FORM = {
  responder_name: '',
  content: '',
};

export function CommunicationRequestsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [responseDialogOpen, setResponseDialogOpen] = useState(false);
  const [responseTarget, setResponseTarget] = useState<CommunicationRequestRow | null>(null);
  const [responseForm, setResponseForm] = useState(DEFAULT_RESPONSE_FORM);

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status:
        | 'sent'
        | 'received'
        | 'in_progress'
        | 'responded'
        | 'closed'
        | 'escalated'
        | 'expired';
    }) => {
      const res = await fetch(`/api/communication-requests/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '依頼ステータスの更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('依頼ステータスを更新しました');
      await queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '依頼ステータスの更新に失敗しました');
    },
  });

  const responseMutation = useMutation({
    mutationFn: async ({
      id,
      responder_name,
      content,
    }: {
      id: string;
      responder_name: string;
      content: string;
    }) => {
      const res = await fetch(`/api/communication-requests/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          response: {
            responder_name,
            content,
            responded_at: new Date().toISOString(),
          },
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '返信記録の保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('返信を記録しました');
      setResponseDialogOpen(false);
      setResponseTarget(null);
      setResponseForm(DEFAULT_RESPONSE_FORM);
      await queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '返信記録の保存に失敗しました');
    },
  });

  const openResponseDialog = (item: CommunicationRequestRow) => {
    setResponseTarget(item);
    setResponseForm({
      responder_name: item.recipient_name ?? '',
      content: '',
    });
    setResponseDialogOpen(true);
  };

  async function handleExport() {
    if (!orgId) return;
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    const response = await fetch(`/api/communication-requests/export?${params.toString()}`, {
      headers: { 'x-org-id': orgId },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      toast.error(payload.message ?? 'CSVエクスポートに失敗しました');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filenameMatch = disposition.match(/filename=\"?([^"]+)\"?/);
    anchor.href = url;
    anchor.download = filenameMatch?.[1] ?? 'communication_requests.csv';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

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

  const { data: eventData, isLoading: isEventsLoading } = useQuery({
    queryKey: ['communication-events', orgId],
    queryFn: async () => {
      const res = await fetch('/api/communication-events?limit=50', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('連携ログの取得に失敗しました');
      return res.json() as Promise<{
        data: CommunicationEventRow[];
        hasMore: boolean;
      }>;
    },
    enabled: !!orgId,
  });

  const eventColumns = useMemo<ColumnDef<CommunicationEventRow>[]>(
    () => [
      {
        accessorKey: 'event_type',
        header: 'イベント',
        cell: ({ row }) => (
          <span className="text-sm font-medium">
            {EVENT_TYPE_LABELS[row.original.event_type] ?? row.original.event_type}
          </span>
        ),
      },
      {
        accessorKey: 'channel',
        header: 'チャネル',
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.channel}</Badge>
        ),
      },
      {
        id: 'counterpart',
        header: '相手先',
        cell: ({ row }) => (
          <div className="text-sm">
            <p className="font-medium">{row.original.counterpart_name ?? '未設定'}</p>
            <p className="text-muted-foreground">{row.original.direction}</p>
          </div>
        ),
      },
      {
        accessorKey: 'subject',
        header: '件名',
        cell: ({ row }) => (
          <span className="max-w-sm truncate text-sm text-muted-foreground">
            {row.original.subject ?? row.original.content ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'occurred_at',
        header: '発生日時',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {format(parseISO(row.original.occurred_at), 'M/d HH:mm', { locale: ja })}
          </span>
        ),
      },
    ],
    []
  );

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
        id: 'recipient',
        header: '宛先',
        cell: ({ row }) => (
          <div className="text-sm">
            <p className="font-medium">
              {row.original.recipient_name ?? '宛先未設定'}
            </p>
            <p className="text-muted-foreground">
              {row.original.recipient_role ?? '役割未設定'}
            </p>
          </div>
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
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex flex-wrap gap-2">
              {item.status === 'draft' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => statusMutation.mutate({ id: item.id, status: 'sent' })}
                  disabled={statusMutation.isPending}
                >
                  送信済みにする
                </Button>
              )}
              {item.status === 'sent' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: item.id, status: 'received' })}
                    disabled={statusMutation.isPending}
                  >
                    受信済み
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: item.id, status: 'escalated' })}
                    disabled={statusMutation.isPending}
                  >
                    エスカレ
                  </Button>
                </>
              )}
              {item.status === 'received' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: item.id, status: 'in_progress' })}
                    disabled={statusMutation.isPending}
                  >
                    対応中へ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openResponseDialog(item)}
                    disabled={responseMutation.isPending}
                  >
                    返信記録
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: item.id, status: 'escalated' })}
                    disabled={statusMutation.isPending}
                  >
                    エスカレ
                  </Button>
                </>
              )}
              {item.status === 'in_progress' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openResponseDialog(item)}
                    disabled={responseMutation.isPending}
                  >
                    返信記録
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: item.id, status: 'escalated' })}
                    disabled={statusMutation.isPending}
                  >
                    エスカレ
                  </Button>
                </>
              )}
              {item.status === 'responded' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => statusMutation.mutate({ id: item.id, status: 'closed' })}
                  disabled={statusMutation.isPending}
                >
                  完了
                </Button>
              )}
              {item.status === 'escalated' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: item.id, status: 'in_progress' })}
                    disabled={statusMutation.isPending}
                  >
                    対応再開
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openResponseDialog(item)}
                    disabled={responseMutation.isPending}
                  >
                    返信記録
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ],
    [responseMutation.isPending, statusMutation]
  );

  return (
    <div className="space-y-4">
      {/* Status filter tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap gap-2">
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
        <Button variant="outline" size="sm" onClick={handleExport}>
          CSVエクスポート
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        caption="依頼・照会一覧"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">連携タイムライン</CardTitle>
          <CardDescription>
            訪問予定変更、報告送付、送達失敗・再送など主要な連携イベントを時系列で確認します。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isEventsLoading ? (
            <p className="text-sm text-muted-foreground">連携タイムラインを読み込み中...</p>
          ) : (eventData?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">連携イベントはまだありません。</p>
          ) : (
            eventData?.data.slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {EVENT_TYPE_LABELS[item.event_type] ?? item.event_type}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.counterpart_name ?? '相手先未設定'} / {item.channel}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(item.occurred_at), 'M/d HH:mm', { locale: ja })}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {item.subject ?? item.content ?? '詳細なし'}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={eventColumns}
        data={eventData?.data ?? []}
        isLoading={isEventsLoading}
        caption="連携ログ一覧"
      />

      <Dialog open={responseDialogOpen} onOpenChange={setResponseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>返信を記録</DialogTitle>
            <DialogDescription>
              {responseTarget?.subject ?? '依頼'} に対する返信内容を記録します。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="responder_name">返信者名</Label>
              <Input
                id="responder_name"
                value={responseForm.responder_name}
                onChange={(event) =>
                  setResponseForm((current) => ({
                    ...current,
                    responder_name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="response_content">返信内容</Label>
              <Textarea
                id="response_content"
                rows={5}
                value={responseForm.content}
                onChange={(event) =>
                  setResponseForm((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResponseDialogOpen(false);
                setResponseTarget(null);
                setResponseForm(DEFAULT_RESPONSE_FORM);
              }}
            >
              キャンセル
            </Button>
            <Button
              onClick={() => {
                if (!responseTarget) return;
                responseMutation.mutate({
                  id: responseTarget.id,
                  responder_name: responseForm.responder_name.trim(),
                  content: responseForm.content.trim(),
                });
              }}
              disabled={
                responseMutation.isPending ||
                responseForm.responder_name.trim().length === 0 ||
                responseForm.content.trim().length === 0
              }
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
