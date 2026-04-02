'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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
import { fetchAllCursorPages } from '@/lib/api/cursor-pagination-client';
import {
  buildCommunicationRequestsHref,
  resolveCommunicationEntityLink,
} from '@/lib/communications/navigation';
import { toast } from 'sonner';

type CommunicationRequestRow = {
  id: string;
  request_type: string;
  subject: string;
  status: string;
  requested_at: string;
  due_date: string | null;
  patient_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
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
  patient_id: string | null;
  channel: string;
  direction: string;
  counterpart_name: string | null;
  subject: string | null;
  content: string | null;
  occurred_at: string;
};

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  draft: { label: '下書き', variant: 'outline' },
  sent: { label: '送信済み', variant: 'secondary' },
  received: { label: '受信済み', variant: 'secondary' },
  in_progress: { label: '対応中', variant: 'default' },
  responded: { label: '返信済み', variant: 'default' },
  closed: { label: '完了', variant: 'outline' },
  escalated: { label: 'エスカレ', variant: 'destructive' },
  cancelled: { label: '取消', variant: 'outline' },
  expired: { label: '期限切れ', variant: 'destructive' },
};

type StatusTransition = {
  label: string;
  nextStatus: 'sent' | 'received' | 'in_progress' | 'responded' | 'closed' | 'escalated' | 'expired';
  variant: 'outline';
  action?: 'response_dialog';
};

const STATUS_TRANSITIONS: Record<string, StatusTransition[]> = {
  draft: [
    { label: '送信済みにする', nextStatus: 'sent', variant: 'outline' },
  ],
  sent: [
    { label: '受信済み', nextStatus: 'received', variant: 'outline' },
    { label: 'エスカレ', nextStatus: 'escalated', variant: 'outline' },
  ],
  received: [
    { label: '対応中へ', nextStatus: 'in_progress', variant: 'outline' },
    { label: '返信記録', nextStatus: 'responded', variant: 'outline', action: 'response_dialog' },
    { label: 'エスカレ', nextStatus: 'escalated', variant: 'outline' },
  ],
  in_progress: [
    { label: '返信記録', nextStatus: 'responded', variant: 'outline', action: 'response_dialog' },
    { label: 'エスカレ', nextStatus: 'escalated', variant: 'outline' },
  ],
  responded: [
    { label: '完了', nextStatus: 'closed', variant: 'outline' },
  ],
  escalated: [
    { label: '対応再開', nextStatus: 'in_progress', variant: 'outline' },
    { label: '返信記録', nextStatus: 'responded', variant: 'outline', action: 'response_dialog' },
  ],
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

type CommunicationRequestsContentProps = {
  initialStatus?: string | null;
  initialPatientId?: string | null;
  initialRelatedEntityType?: string | null;
  initialRelatedEntityId?: string | null;
};

export function CommunicationRequestsContent({
  initialStatus,
  initialPatientId,
  initialRelatedEntityType,
  initialRelatedEntityId,
}: CommunicationRequestsContentProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState(initialStatus ?? '');
  const [responseDialogOpen, setResponseDialogOpen] = useState(false);
  const [responseTarget, setResponseTarget] = useState<CommunicationRequestRow | null>(null);
  const [responseForm, setResponseForm] = useState(DEFAULT_RESPONSE_FORM);
  const patientFilter = initialPatientId ?? '';
  const relatedEntityTypeFilter = initialRelatedEntityType ?? '';
  const relatedEntityIdFilter = initialRelatedEntityId ?? '';
  const relatedEntityLink = resolveCommunicationEntityLink({
    entityType: relatedEntityTypeFilter || null,
    entityId: relatedEntityIdFilter || null,
  });

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
    queryKey: [
      'communication-requests',
      orgId,
      statusFilter,
      patientFilter,
      relatedEntityTypeFilter,
      relatedEntityIdFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (patientFilter) params.set('patient_id', patientFilter);
      if (relatedEntityTypeFilter) params.set('related_entity_type', relatedEntityTypeFilter);
      if (relatedEntityIdFilter) params.set('related_entity_id', relatedEntityIdFilter);
      return fetchAllCursorPages<CommunicationRequestRow, {
        data: CommunicationRequestRow[];
        hasMore: boolean;
      }>({
        path: '/api/communication-requests',
        params,
        init: { headers: { 'x-org-id': orgId } },
        errorMessage: '依頼一覧の取得に失敗しました',
      });
    },
    enabled: !!orgId,
  });

  const { data: eventData, isLoading: isEventsLoading } = useQuery({
    queryKey: ['communication-events', orgId, patientFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (patientFilter) params.set('patient_id', patientFilter);
      return fetchAllCursorPages<CommunicationEventRow, {
        data: CommunicationEventRow[];
        hasMore: boolean;
      }>({
        path: '/api/communication-events',
        params,
        init: { headers: { 'x-org-id': orgId } },
        errorMessage: '連携ログの取得に失敗しました',
      });
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
        id: 'patient',
        header: '患者',
        cell: ({ row }) =>
          row.original.patient_id ? (
            <Link
              href={`/patients/${row.original.patient_id}`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              患者詳細
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
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
        id: 'patient',
        header: '患者',
        cell: ({ row }) =>
          row.original.patient_id ? (
            <Link
              href={`/patients/${row.original.patient_id}`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              患者詳細
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: 'related',
        header: '関連',
        cell: ({ row }) => {
          const entityLink = resolveCommunicationEntityLink({
            entityType: row.original.related_entity_type,
            entityId: row.original.related_entity_id,
          });

          return entityLink ? (
            <Link
              href={entityLink.href}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {entityLink.label}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'ステータス',
        cell: ({ row }) => {
          const cfg = STATUS_CONFIG[row.original.status];
          return (
            <Badge variant={cfg?.variant ?? 'outline'}>
              {cfg?.label ?? row.original.status}
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
          const transitions = STATUS_TRANSITIONS[item.status] ?? [];
          return (
            <div className="flex flex-wrap gap-2">
              {transitions.map((t) => (
                <Button
                  key={t.label}
                  size="sm"
                  variant={t.variant}
                  onClick={() =>
                    t.action === 'response_dialog'
                      ? openResponseDialog(item)
                      : statusMutation.mutate({ id: item.id, status: t.nextStatus })
                  }
                  disabled={
                    t.action === 'response_dialog'
                      ? responseMutation.isPending
                      : statusMutation.isPending
                  }
                >
                  {t.label}
                </Button>
              ))}
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

      {patientFilter || relatedEntityTypeFilter || relatedEntityIdFilter ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
          <span className="font-medium text-foreground">適用中の文脈:</span>
          {patientFilter ? (
            <Link href={`/patients/${patientFilter}`} className="text-primary underline-offset-4 hover:underline">
              <Badge variant="outline">患者詳細</Badge>
            </Link>
          ) : null}
          {relatedEntityTypeFilter ? (
            <Badge variant="outline">関連種別 {relatedEntityTypeFilter}</Badge>
          ) : null}
          {relatedEntityIdFilter ? <Badge variant="outline">関連ID {relatedEntityIdFilter}</Badge> : null}
          {relatedEntityLink ? (
            <Link href={relatedEntityLink.href} className="text-primary underline-offset-4 hover:underline">
              {relatedEntityLink.label}
            </Link>
          ) : null}
          <Link
            href={buildCommunicationRequestsHref({ status: statusFilter || null })}
            className="text-primary underline-offset-4 hover:underline"
          >
            文脈をクリア
          </Link>
        </div>
      ) : null}

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
                {item.patient_id ? (
                  <Link
                    href={`/patients/${item.patient_id}`}
                    className="mt-2 inline-flex text-xs text-primary underline-offset-4 hover:underline"
                  >
                    患者詳細へ
                  </Link>
                ) : null}
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
