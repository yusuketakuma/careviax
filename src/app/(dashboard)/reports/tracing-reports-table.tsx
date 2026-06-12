'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { cn } from '@/lib/utils';
import { formatDateLabel } from '@/lib/ui/date-format';

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
  const queryClient = useQueryClient();

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
    </Card>
  );
}
