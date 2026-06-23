'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  CHANNEL_LABELS,
  REPORT_STATUS_CONFIG,
  REPORT_TYPE_LABELS,
} from '@/lib/constants/status-labels';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { cn } from '@/lib/utils';
import { formatDateLabel } from '@/lib/ui/date-format';

type DeliveryAnalyticsResponse = {
  data: {
    summary: {
      current_month: string;
      current_month_attempted_count: number;
      current_month_success_rate: number;
      current_month_failed_count: number;
      current_month_confirmed_rate: number;
      overdue_waiting_count: number;
      overdue_threshold_days: number;
    };
    monthly_trend: Array<{
      month: string;
      attempted_count: number;
      success_count: number;
      failed_count: number;
      confirmed_count: number;
      response_waiting_count: number;
      success_rate: number;
      confirmed_rate: number;
    }>;
    physician_breakdown: Array<{
      recipient_name: string;
      total_count: number;
      success_count: number;
      confirmed_count: number;
      success_rate: number;
    }>;
    channel_breakdown: Array<{
      channel: string;
      total_count: number;
      success_count: number;
      failed_count: number;
      success_rate: number;
    }>;
    overdue_waiting: Array<{
      id: string;
      report_id: string;
      patient_id: string;
      patient_name: string;
      report_type: string;
      recipient_name: string;
      recipient_contact: string;
      channel: string;
      sent_at: string;
      days_waiting: number;
    }>;
  };
};

type AnalyticsTableRow = {
  id: string;
  values: string[];
};

const REPORT_DELIVERY_REMINDER_DISABLED_REASON_ID = 'report-delivery-reminder-disabled-reason';
const REPORT_DELIVERY_REMINDER_DISABLED_REASON = '送達分析を読み込んでいます。';

export function ReportDeliveryDashboard({ highlighted = false }: { highlighted?: boolean }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [overdueDays, setOverdueDays] = useState('7');

  const normalizedOverdueDays = useMemo(() => {
    const parsed = Number(overdueDays);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
  }, [overdueDays]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['care-report-analytics', orgId, normalizedOverdueDays],
    queryFn: async () => {
      const response = await fetch(
        `/api/care-reports/analytics?overdue_days=${normalizedOverdueDays}`,
        {
          headers: buildOrgHeaders(orgId),
        },
      );
      if (!response.ok) throw new Error('報告書分析の取得に失敗しました');
      return response.json() as Promise<DeliveryAnalyticsResponse>;
    },
    enabled: !!orgId,
  });

  const reminderMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/care-reports/reminders', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ overdue_days: normalizedOverdueDays }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? 'リマインド起票に失敗しました',
        );
      }
      return payload as { data: { queued_count: number } };
    },
    onSuccess: async (payload) => {
      toast.success(`リマインドタスクを ${payload.data.queued_count} 件起票しました`);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['care-report-analytics', orgId, normalizedOverdueDays],
        }),
        queryClient.invalidateQueries({
          queryKey: ['care-reports', orgId],
          exact: false,
        }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'リマインドタスクの起票に失敗しました');
    },
  });

  const analytics = data?.data;
  const reminderDisabledReason = !analytics ? REPORT_DELIVERY_REMINDER_DISABLED_REASON : null;

  return (
    <div
      className={cn('space-y-4', highlighted ? 'rounded-2xl ring-2 ring-primary/25' : null)}
      data-testid="reports-delivery-dashboard"
    >
      <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-4">
        <h2 className="text-base font-semibold text-foreground">送達分析・未確認フォロー</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          一覧で対象報告を確認したあとに、送達傾向や返信待ちの滞留をまとめて見返すセクションです。
        </p>
      </div>

      {isError ? (
        <ErrorState
          variant="server"
          title="送達分析を表示できません"
          description="報告書の送達傾向と未確認フォロー対象の取得に失敗しました。再試行してください。"
          detail="取得失敗時は、未確認報告がないものとして扱わず、リマインド起票も停止しています。"
          action={{ label: '再試行', onClick: () => void refetch() }}
          headingLevel={3}
        />
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="今月の送達成功率"
                value={analytics ? `${analytics.summary.current_month_success_rate}%` : '—'}
                detail={
                  analytics
                    ? `${analytics.summary.current_month} / ${analytics.summary.current_month_attempted_count}件`
                    : '送達データを集計中'
                }
              />
              <SummaryCard
                label="今月の確認率"
                value={analytics ? `${analytics.summary.current_month_confirmed_rate}%` : '—'}
                detail={
                  analytics
                    ? `失敗 ${analytics.summary.current_month_failed_count}件`
                    : '確認データを集計中'
                }
              />
              <SummaryCard
                label="返信待ち超過"
                value={analytics ? `${analytics.summary.overdue_waiting_count}件` : '—'}
                detail={
                  analytics
                    ? `${analytics.summary.overdue_threshold_days}日以上の response_waiting`
                    : '閾値に応じて集計'
                }
              />
              <SummaryCard
                label="主要チャネル"
                value={
                  analytics?.channel_breakdown[0]
                    ? (CHANNEL_LABELS[analytics.channel_breakdown[0].channel] ??
                      analytics.channel_breakdown[0].channel)
                    : '—'
                }
                detail={
                  analytics?.channel_breakdown[0]
                    ? `${analytics.channel_breakdown[0].success_rate}% / ${analytics.channel_breakdown[0].total_count}件`
                    : 'チャネル別分析'
                }
              />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">未確認報告のフォロー</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">超過日数</p>
                    <Input
                      aria-label="未確認報告の超過日数"
                      type="number"
                      min={1}
                      max={90}
                      value={overdueDays}
                      onChange={(event) => setOverdueDays(event.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => reminderMutation.mutate()}
                    aria-describedby={
                      reminderDisabledReason
                        ? REPORT_DELIVERY_REMINDER_DISABLED_REASON_ID
                        : undefined
                    }
                    disabled={reminderMutation.isPending || Boolean(reminderDisabledReason)}
                  >
                    リマインドタスク起票
                  </Button>
                </div>
                {reminderDisabledReason ? (
                  <p
                    id={REPORT_DELIVERY_REMINDER_DISABLED_REASON_ID}
                    className="text-xs text-muted-foreground"
                  >
                    {reminderDisabledReason}
                  </p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  `response_waiting` が閾値を超えた送達を抽出し、担当者に follow-up
                  タスクを作成します。
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr]">
            <AnalyticsTableCard
              title="月別送達成功率"
              headers={['月', '成功率', '確認率', '失敗', '返信待ち']}
              rows={(analytics?.monthly_trend ?? []).map((item) => [
                item.month,
                `${item.success_rate}% (${item.success_count}/${item.attempted_count})`,
                `${item.confirmed_rate}%`,
                `${item.failed_count}件`,
                `${item.response_waiting_count}件`,
              ])}
              emptyMessage={isLoading ? '集計中です…' : '送達データがありません'}
            />
            <AnalyticsTableCard
              title="医師別送達"
              headers={['送付先', '成功率', '確認率']}
              rows={(analytics?.physician_breakdown ?? []).map((item) => [
                item.recipient_name,
                `${item.success_rate}% (${item.success_count}/${item.total_count})`,
                `${item.confirmed_count}件`,
              ])}
              emptyMessage={isLoading ? '集計中です…' : '医師宛送達がありません'}
            />
            <AnalyticsTableCard
              title="チャネル別送達"
              headers={['チャネル', '成功率', '失敗']}
              rows={(analytics?.channel_breakdown ?? []).map((item) => [
                CHANNEL_LABELS[item.channel] ?? item.channel,
                `${item.success_rate}% (${item.success_count}/${item.total_count})`,
                `${item.failed_count}件`,
              ])}
              emptyMessage={isLoading ? '集計中です…' : 'チャネル別データがありません'}
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">未確認報告書一覧</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics?.overdue_waiting.length ? (
                <div className="space-y-3">
                  {analytics.overdue_waiting.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{item.patient_name}</p>
                          <Badge variant="outline">
                            {REPORT_TYPE_LABELS[item.report_type] ?? item.report_type}
                          </Badge>
                          <Badge
                            variant={
                              item.days_waiting >= normalizedOverdueDays * 2
                                ? REPORT_STATUS_CONFIG.failed.variant
                                : REPORT_STATUS_CONFIG.response_waiting.variant
                            }
                          >
                            {item.days_waiting}日経過
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {item.recipient_name} / {CHANNEL_LABELS[item.channel] ?? item.channel} /{' '}
                          {formatDateLabel(item.sent_at)}
                        </p>
                        <p className="text-xs text-muted-foreground">{item.recipient_contact}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={buildPatientHref(item.patient_id)}
                          className={cn(buttonVariants({ variant: 'ghost' }))}
                        >
                          患者詳細
                        </Link>
                        <Link
                          href={buildCommunicationRequestsHref({
                            patientId: item.patient_id,
                            relatedEntityType: 'care_report',
                            relatedEntityId: item.report_id,
                          })}
                          className={cn(buttonVariants({ variant: 'outline' }))}
                        >
                          関連依頼
                        </Link>
                        <Link
                          href={buildReportHref(item.report_id)}
                          className={cn(buttonVariants({ variant: 'outline' }))}
                        >
                          報告書を開く
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">
                  {isLoading
                    ? '未確認報告を集計しています…'
                    : `${normalizedOverdueDays}日超の未確認報告はありません。`}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function AnalyticsTableCard({
  title,
  headers,
  rows,
  emptyMessage,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  emptyMessage: string;
}) {
  const tableRows = useMemo<AnalyticsTableRow[]>(
    () => rows.map((row, index) => ({ id: `${title}-${index}`, values: row })),
    [rows, title],
  );
  const columns = useMemo<ColumnDef<AnalyticsTableRow>[]>(
    () =>
      headers.map((header, index) => ({
        id: `column_${index}`,
        accessorFn: (row) => row.values[index] ?? '',
        header,
        cell: ({ row }) => row.original.values[index] ?? '',
        meta: { label: header },
      })),
    [headers],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <DataTable
            columns={columns}
            data={tableRows}
            caption={title}
            getRowId={(row) => row.id}
            getRowA11yLabel={(row) => `${title} ${row.values.join(' ')}`}
            toolbar={{
              enableGlobalFilter: true,
              globalFilterPlaceholder: `${title}内検索`,
              enableColumnVisibility: true,
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
