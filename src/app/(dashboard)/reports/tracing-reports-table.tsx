'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Send, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { cn } from '@/lib/utils';
import { formatDateLabel } from '@/lib/ui/date-format';

/**
 * 送付チャネルの選択肢。
 *
 * - ph_os_share / email は自動送信可能な届けられるチャネル（既定は ph_os_share）。
 * - FAX は記録専用。本システムは FAX ゲートウェイを持たないため自動送信は行わず、
 *   手動で送付した事実を postal（郵送扱いの手動送付）として記録する。
 *   つまり「FAX（手動送付の記録）」を選んでも自動送信は発生しない。
 * - 手渡し（in_person）も人手による手動送付の記録。
 *
 * value は API（communicationChannelSchema）が受け付けるチャネル値。
 */
const SEND_CHANNEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'ph_os_share', label: 'アプリ内共有（推奨）' },
  { value: 'email', label: 'メール' },
  { value: 'postal', label: 'FAX（手動送付の記録）' },
  { value: 'in_person', label: '手渡し' },
];

const DEFAULT_SEND_CHANNEL = 'ph_os_share';

type SendDialogState = {
  reportId: string;
  patientName: string | null;
  channel: string;
  physician: string;
  reason: string;
};

type TracingReport = {
  id: string;
  patient_id: string;
  patient_name: string | null;
  status: 'draft' | 'sent' | 'received' | 'acknowledged';
  sent_to_physician: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
};

type TracingReportsResponse = {
  data: TracingReport[];
  pagination: { hasMore: boolean; nextCursor: string | null };
};

const STATUS_META: Record<
  TracingReport['status'],
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  draft: { label: '下書き', variant: 'outline' },
  sent: { label: '送付済', variant: 'default' },
  received: { label: '受領済', variant: 'secondary' },
  acknowledged: { label: '確認済', variant: 'secondary' },
};

export function TracingReportsTable() {
  const orgId = useOrgId();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sendDialog, setSendDialog] = useState<SendDialogState | null>(null);
  const queryClient = useQueryClient();

  const sendMutation = useMutation({
    mutationFn: async (state: SendDialogState) => {
      const physician = state.physician.trim();
      const reason = state.reason.trim();
      const res = await fetch(`/api/tracing-reports/${state.reportId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          status: 'sent',
          channel: state.channel,
          ...(physician ? { sent_to_physician: physician } : {}),
          status_change_reason: reason,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message ?? '送付に失敗しました');
      }
    },
    onSuccess: () => {
      setSendDialog(null);
      void queryClient.invalidateQueries({ queryKey: ['tracing-reports'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tracing-reports/${id}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message ?? '削除に失敗しました');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tracing-reports'] });
    },
  });

  const { data, isLoading } = useQuery<TracingReportsResponse>({
    queryKey: ['tracing-reports', orgId, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/tracing-reports?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('トレーシングレポートの取得に失敗しました');
      return res.json();
    },
    staleTime: 30_000,
    enabled: !!orgId,
  });

  const reports = data?.data ?? [];

  return (
    <Card id="tracing-reports">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">トレーシングレポート</CardTitle>
            <CardDescription>
              処方医への疑義照会・情報提供のトレーシングレポートを管理します。
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {(['', 'draft', 'sent', 'received', 'acknowledged'] as const).map(
              (s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(s)}
                >
                  {s === '' ? '全て' : STATUS_META[s].label}
                </Button>
              )
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loading label="トレーシングレポートを読み込み中..." />
        ) : reports.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="トレーシングレポートはありません"
            description="疑義照会・情報提供のレポートが作成されるとここに表示されます。"
          />
        ) : (
          <ul className="divide-y divide-border" role="list">
            {reports.map((report) => {
              const meta = STATUS_META[report.status];
              return (
                <li key={report.id}>
                  <div className="flex flex-col gap-3 rounded-md px-2 py-3 -mx-2 transition-colors hover:bg-muted/50 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {report.patient_name && (
                          <span className="text-sm font-medium text-foreground">
                            {report.patient_name}
                          </span>
                        )}
                        {report.sent_to_physician && (
                          <span className="text-sm text-muted-foreground">
                            → {report.sent_to_physician}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        作成日 {formatDateLabel(report.created_at)}
                        {report.sent_at && ` / 送付日 ${formatDateLabel(report.sent_at)}`}
                        {report.acknowledged_at &&
                          ` / 確認日 ${formatDateLabel(report.acknowledged_at)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/patients/${report.patient_id}`}
                        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                      >
                        患者詳細
                      </Link>
                      <Link
                        href={buildCommunicationRequestsHref({
                          patientId: report.patient_id,
                          relatedEntityType: 'tracing_report',
                          relatedEntityId: report.id,
                        })}
                        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                      >
                        関連依頼
                      </Link>
                      {report.pdf_url ? (
                        <Link
                          href={report.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                        >
                          <FileText className="mr-1.5 size-4" aria-hidden="true" />
                          PDF
                        </Link>
                      ) : null}
                      {report.status === 'draft' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setSendDialog({
                              reportId: report.id,
                              patientName: report.patient_name,
                              channel: DEFAULT_SEND_CHANNEL,
                              physician: report.sent_to_physician ?? '',
                              reason: '',
                            })
                          }
                        >
                          <Send className="mr-1.5 size-4" aria-hidden="true" />
                          送付
                        </Button>
                      )}
                      {report.status === 'draft' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (confirm('この下書きを削除しますか？')) {
                              deleteMutation.mutate(report.id);
                            }
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          削除
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={sendDialog !== null}
        onOpenChange={(open) => {
          if (!open) setSendDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>トレーシングレポートを送付</DialogTitle>
            <DialogDescription>
              {sendDialog?.patientName
                ? `${sendDialog.patientName} のレポートを送付します。`
                : 'レポートを送付します。'}
              送付チャネルを必ず明示的に選択してください。
            </DialogDescription>
          </DialogHeader>

          {sendDialog ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="tracing-send-channel">送付チャネル</Label>
                <Select
                  value={sendDialog.channel}
                  onValueChange={(value) =>
                    setSendDialog((prev) =>
                      prev ? { ...prev, channel: value ?? prev.channel } : prev,
                    )
                  }
                >
                  <SelectTrigger
                    id="tracing-send-channel"
                    className="w-full min-h-[44px] sm:h-8 sm:min-h-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEND_CHANNEL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  FAX は自動送信されません。手動で送付した記録として残ります。
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tracing-send-physician">送付先医師名</Label>
                <Input
                  id="tracing-send-physician"
                  value={sendDialog.physician}
                  onChange={(event) =>
                    setSendDialog((prev) =>
                      prev ? { ...prev, physician: event.target.value } : prev,
                    )
                  }
                  placeholder="例: 在宅主治医"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tracing-send-reason">
                  送付理由{' '}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </Label>
                <Textarea
                  id="tracing-send-reason"
                  value={sendDialog.reason}
                  onChange={(event) =>
                    setSendDialog((prev) =>
                      prev ? { ...prev, reason: event.target.value } : prev,
                    )
                  }
                  placeholder="例: 医師へ服薬情報提供書を送付"
                  rows={3}
                />
              </div>

              {sendMutation.isError ? (
                <p className="text-sm text-destructive">
                  {sendMutation.error instanceof Error
                    ? sendMutation.error.message
                    : '送付に失敗しました'}
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" disabled={sendMutation.isPending} />
              }
            >
              キャンセル
            </DialogClose>
            <Button
              disabled={sendMutation.isPending || !sendDialog?.reason.trim()}
              onClick={() => {
                if (sendDialog) sendMutation.mutate(sendDialog);
              }}
            >
              <Send className="mr-1.5 size-4" aria-hidden="true" />
              {sendMutation.isPending ? '送付中...' : '送付する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
