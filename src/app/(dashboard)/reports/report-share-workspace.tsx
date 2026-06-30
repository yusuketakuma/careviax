'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WorkspaceActionRail } from '@/components/features/workspace/action-rail';
import { MainWorkflowCompactNav } from '@/components/features/workflow/main-workflow-route';
import { readApiJson } from '@/lib/api/client-json';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientHref } from '@/lib/patient/navigation';
import { generateCareReportFromVisit } from '@/lib/reports/generate-from-visit-client';
import type { GeneratedCareReportSummary } from '@/lib/reports/generate-from-visit-contract';
import { displayDeliveryFailureReason } from '@/lib/reports/delivery-failure-reasons';
import { buildReportHref } from '@/lib/reports/navigation';
import { cn } from '@/lib/utils';
import { timeIsoToString } from '@/lib/visits/time-of-day';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type {
  ReportDraftGenerationTarget,
  ReportsTodayWorkspaceResponse,
  ReportCreatedRow,
  ReportOpenIssue,
  ReportWaitingReply,
} from '@/types/reports-today-workspace';
import {
  buildHeaderMeta,
  buildReportEvidence,
  buildWorkspaceBlockedReasons,
  buildWorkspaceNextAction,
  formatWorkspaceCountLabel,
  formatTimeOfDay,
  waitingBadgeLabel,
} from './report-share-workspace.helpers';

/**
 * new_10_report(docs/design-gap-analysis-new.md)「報告・共有」ワークスペース。
 * 本文(今日書く報告 → 返信待ち/今日解決した待ち → テンプレート方針バー)+
 * 右レール(次にやること/止まっている理由/根拠・記録)の 2 カラム構成。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

const DRAFT_STATUS_LABELS: Record<string, string> = {
  before_visit: '訪問後に下書き',
  ready_to_generate: '未作成',
  draft_ready: '下書きあり',
  report_existing: '作成済み',
};

const ISSUE_TONE_CLASSES: Record<ReportOpenIssue['severity'], string> = {
  critical: 'border-transparent bg-state-blocked/10 text-state-blocked',
  warning: 'border-transparent bg-state-confirm/10 text-state-confirm',
  info: 'border-transparent bg-tag-info/10 text-tag-info',
};

const DELIVERY_CHANNEL_LABELS: Record<string, string> = {
  email: 'メール',
  ses: 'メール',
  fax: 'FAX',
  phone: '電話',
  in_person: '対面',
  postal: '郵送',
  ph_os_share: 'PH-OS共有',
};

const reportOutlineActionClassName = cn(
  buttonVariants({ variant: 'outline', size: 'sm' }),
  '!h-auto !min-h-[44px] sm:!h-auto sm:!min-h-[44px]',
);

type GeneratedCareReport = GeneratedCareReportSummary;
type DraftGenerationInput = {
  visitRecordId: string;
  visitRecordUpdatedAt: string;
  reportType: ReportDraftGenerationTarget['report_type'];
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${month}/${day} ${formatTimeOfDay(iso)}`;
}

function deliveryRetryLabel(retryCount: number): string {
  return retryCount > 0 ? `再送${retryCount}回` : '再送未実施';
}

async function fetchReportsTodayWorkspace(orgId: string): Promise<ReportsTodayWorkspaceResponse> {
  const res = await fetch('/api/care-reports/today-workspace', {
    headers: { 'x-org-id': orgId },
  });
  const json = await readApiJson<{ data: ReportsTodayWorkspaceResponse }>(
    res,
    '報告ワークスペースの取得に失敗しました',
  );
  return json.data;
}

async function fetchOperationCockpit(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: { 'x-org-id': orgId },
  });
  const json = await readApiJson<{ data: DashboardCockpitResponse }>(
    res,
    '当日オペレーション情報の取得に失敗しました',
  );
  return json.data;
}

// ---------------------------------------------------------------------------
// 今日書く報告
// ---------------------------------------------------------------------------

function TodayDraftsCard({
  data,
  onGenerateDraft,
  generatingDraftKey,
  isGeneratingDraft,
}: {
  data: ReportsTodayWorkspaceResponse;
  onGenerateDraft: (input: DraftGenerationInput) => void;
  generatingDraftKey: string | null;
  isGeneratingDraft: boolean;
}) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="report-today-drafts-heading"
      data-testid="report-today-drafts"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="report-today-drafts-heading" className="text-base font-bold text-foreground">
          未作成・下書き一覧 — 訪問完了後に選択して作成
        </h3>
        <p className="text-xs text-muted-foreground">
          訪問記録から下書きを自動作成し、薬剤師が手直しして確定します
        </p>
      </div>
      {data.draft_rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          本日の訪問予定はありません。訪問が完了すると、ここに報告の下書きが並びます。
        </p>
      ) : (
        <Table className="mt-3 block md:table">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              <TableHead className="w-20">訪問</TableHead>
              <TableHead>患者</TableHead>
              <TableHead>宛先</TableHead>
              <TableHead className="w-36">状態</TableHead>
              <TableHead className="w-44">
                <span className="sr-only">補足・アクション</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block space-y-2 md:table-row-group md:space-y-0">
            {data.draft_rows.map((row) => (
              <TableRow
                key={row.id}
                className="block rounded-md border border-border/70 bg-card px-3 py-2.5 md:table-row md:rounded-none md:border-x-0 md:border-t-0 md:bg-transparent md:p-0"
                data-testid="report-draft-row"
              >
                <TableCell className="block p-0 font-semibold tabular-nums text-foreground md:table-cell md:p-2">
                  <span className="mr-2 text-xs font-medium text-muted-foreground md:hidden">
                    訪問
                  </span>
                  <span>
                    {row.time_start ? (timeIsoToString(row.time_start) ?? '--:--') : '--:--'}
                  </span>
                </TableCell>
                <TableCell className="mt-1 block p-0 font-medium text-foreground md:table-cell md:mt-0 md:p-2">
                  {row.patient_label}
                </TableCell>
                <TableCell className="mt-1 block p-0 text-sm text-foreground md:table-cell md:mt-0 md:p-2">
                  <span className="mr-2 text-xs font-medium text-muted-foreground md:hidden">
                    宛先
                  </span>
                  <span>{row.recipient_label}</span>
                </TableCell>
                <TableCell className="mt-2 block p-0 md:table-cell md:mt-0 md:p-2">
                  <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {DRAFT_STATUS_LABELS[row.status] ?? row.status}
                  </span>
                </TableCell>
                <TableCell className="mt-2 block p-0 md:table-cell md:mt-0 md:p-2">
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    {row.note ? (
                      // 危険区分メモ(麻薬使用状況を含む 等)は隠さず常時表示する
                      <span className="text-xs text-muted-foreground">{row.note}</span>
                    ) : null}
                    {row.action ? (
                      <Link
                        href={row.action.href}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-medium text-primary hover:bg-primary/10 sm:min-h-[44px]"
                      >
                        {row.action.label}
                      </Link>
                    ) : null}
                    {row.status === 'ready_to_generate' &&
                    row.visit_record_id &&
                    row.visit_record_updated_at ? (
                      <span className="flex flex-wrap justify-start gap-2 md:justify-end">
                        {row.generation_targets.map((target) => {
                          const draftKey = `${row.visit_record_id}:${target.report_type}`;
                          const isButtonGenerating = generatingDraftKey === draftKey;
                          return (
                            <Button
                              key={target.report_type}
                              type="button"
                              size="sm"
                              onClick={() =>
                                onGenerateDraft({
                                  visitRecordId: row.visit_record_id!,
                                  visitRecordUpdatedAt: row.visit_record_updated_at!,
                                  reportType: target.report_type,
                                })
                              }
                              disabled={isGeneratingDraft}
                              aria-label={`${row.patient_label} ${target.label}の下書きを自動作成`}
                              className="h-auto min-h-[44px] px-3 sm:min-h-[44px]"
                            >
                              {isButtonGenerating
                                ? '作成中...'
                                : row.generation_targets.length === 1
                                  ? '下書きを自動作成'
                                  : `${target.label}を作成`}
                            </Button>
                          );
                        })}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 返信待ち / 今日解決した待ち
// ---------------------------------------------------------------------------

function WaitingReplyRow({ reply }: { reply: ReportWaitingReply }) {
  return (
    <li
      className="rounded-lg border border-border/70 bg-card p-3"
      data-testid="report-waiting-reply"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded-full bg-state-waiting/10 px-2 py-0.5 text-xs font-bold tabular-nums text-state-waiting">
          {waitingBadgeLabel(reply.waiting_days)}
        </span>
        <p className="min-w-0 flex-1 text-sm font-bold leading-5 text-foreground">{reply.title}</p>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {reply.actions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className={cn(reportOutlineActionClassName, 'text-primary')}
            >
              {action.label}
            </Link>
          ))}
        </span>
      </div>
      {reply.subtitle ? (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{reply.subtitle}</p>
      ) : null}
    </li>
  );
}

function WaitingBoxesSection({ data }: { data: ReportsTodayWorkspaceResponse }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="report-waiting-heading"
        data-testid="report-waiting-box"
      >
        <div className="flex items-baseline gap-2">
          <h3 id="report-waiting-heading" className="text-base font-bold text-foreground">
            返信待ち
          </h3>
          <span className="text-xs text-muted-foreground">
            {formatWorkspaceCountLabel(data.count_metadata?.waiting, data.waiting_replies.length)}
          </span>
        </div>
        {data.waiting_replies.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">返信待ちはありません。</p>
        ) : (
          <ul className="mt-3 space-y-2" role="list">
            {data.waiting_replies.map((reply) => (
              <WaitingReplyRow key={reply.id} reply={reply} />
            ))}
          </ul>
        )}
      </section>

      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="report-resolved-heading"
        data-testid="report-resolved-box"
      >
        <div className="flex items-baseline gap-2">
          <h3 id="report-resolved-heading" className="text-base font-bold text-foreground">
            今日解決した待ち
          </h3>
          <span className="text-xs text-muted-foreground">
            {formatWorkspaceCountLabel(data.count_metadata?.resolved, data.resolved_today.length)}
          </span>
        </div>
        {data.resolved_today.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">今日解決した待ちはまだありません。</p>
        ) : (
          <ul className="mt-3 space-y-2" role="list">
            {data.resolved_today.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-border/70 border-l-2 border-l-state-done bg-card p-3"
                data-testid="report-resolved-row"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex shrink-0 items-center rounded-full bg-state-done/10 px-2 py-0.5 text-xs font-bold tabular-nums text-state-done">
                    回答受領 {formatTimeOfDay(item.received_at)}
                  </span>
                  <p className="min-w-0 flex-1 text-sm font-bold leading-5 text-foreground">
                    {item.title}
                  </p>
                  <Link
                    href={item.action.href}
                    className={cn(reportOutlineActionClassName, 'shrink-0 text-primary')}
                  >
                    {item.action.label}
                  </Link>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{item.subtitle}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReportOpenIssuesSection({
  issues,
  count,
}: {
  issues: ReportOpenIssue[];
  count: ReportsTodayWorkspaceResponse['count_metadata']['open_issues'] | null | undefined;
}) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="report-open-issues-heading"
      data-testid="report-open-issues"
    >
      <div className="flex items-baseline gap-2">
        <h3 id="report-open-issues-heading" className="text-base font-bold text-foreground">
          残課題
        </h3>
        <span className="text-xs text-muted-foreground">
          {formatWorkspaceCountLabel(count, issues.length)}
        </span>
      </div>
      {issues.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          報告書の確認・送付・根拠記録で止まっている課題はありません。
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/70" role="list">
          {issues.map((issue) => (
            <li key={issue.id} className="flex flex-wrap items-start gap-3 py-3">
              <span
                className={cn(
                  'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold',
                  ISSUE_TONE_CLASSES[issue.severity],
                )}
              >
                {issue.severity === 'critical'
                  ? '要対応'
                  : issue.severity === 'warning'
                    ? '確認'
                    : '情報'}
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-sm font-bold text-foreground">{issue.title}</span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  {issue.description}
                </span>
              </span>
              <Link
                href={issue.action.href}
                className={cn(reportOutlineActionClassName, 'text-primary')}
              >
                {issue.action.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CreatedReportStatusCell({ report }: { report: ReportCreatedRow }) {
  if (report.failed_delivery) {
    const failedDelivery = report.failed_delivery;
    const failureReason = displayDeliveryFailureReason(failedDelivery.failure_reason);
    return (
      <div className="space-y-2">
        <div className="rounded-md border-l-4 border-border/70 border-l-state-blocked bg-card p-2 text-state-blocked">
          <span className="block text-sm font-semibold">送付失敗</span>
          <span className="block text-xs leading-5">
            {(DELIVERY_CHANNEL_LABELS[failedDelivery.channel] ?? failedDelivery.channel) +
              ` / ${failedDelivery.recipient_label} / ${deliveryRetryLabel(
                failedDelivery.retry_count,
              )}`}
          </span>
          {failureReason ? <span className="block text-xs leading-5">{failureReason}</span> : null}
          <Link
            href={failedDelivery.action.href}
            className={cn(
              reportOutlineActionClassName,
              'mt-2 border-state-blocked/30 bg-background text-state-blocked hover:bg-state-blocked/10',
            )}
          >
            {failedDelivery.action.label}
          </Link>
        </div>
        {report.reported_to_professional ? (
          <span className="block text-xs leading-5 text-muted-foreground">
            直近成功: {report.last_sent_at ? formatDateTime(report.last_sent_at) : '送信日時未記録'}
            {report.last_recipient_label ? ` / ${report.last_recipient_label}` : ''}
          </span>
        ) : null}
      </div>
    );
  }

  if (!report.reported_to_professional) {
    return (
      <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        他職種未報告
      </span>
    );
  }

  return (
    <span className="space-y-1">
      <span className="block text-sm font-semibold text-state-done">他職種へ報告済み</span>
      <span className="block text-xs text-muted-foreground">
        {report.last_sent_at ? formatDateTime(report.last_sent_at) : '送信日時未記録'}
        {report.last_recipient_label ? ` / ${report.last_recipient_label}` : ''}
        {report.last_channel
          ? ` / ${DELIVERY_CHANNEL_LABELS[report.last_channel] ?? report.last_channel}`
          : ''}
      </span>
    </span>
  );
}

function CreatedReportsSection({
  reports,
  count,
}: {
  reports: ReportCreatedRow[];
  count: ReportsTodayWorkspaceResponse['count_metadata']['created'] | null | undefined;
}) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="created-reports-heading"
      data-testid="report-created-list"
    >
      <div className="flex items-baseline gap-2">
        <h3 id="created-reports-heading" className="text-base font-bold text-foreground">
          作成済み報告書
        </h3>
        <span className="text-xs text-muted-foreground">
          {formatWorkspaceCountLabel(count, reports.length)}
        </span>
      </div>
      {reports.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">作成済み報告書はありません。</p>
      ) : (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>患者・報告書</TableHead>
              <TableHead className="w-28">状態</TableHead>
              <TableHead className="w-56">他職種報告</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">詳細</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => (
              <TableRow key={report.id}>
                <TableCell>
                  {report.patient_id ? (
                    <Link
                      href={buildPatientHref(report.patient_id)}
                      className="inline-flex min-h-8 items-center rounded-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {report.patient_label}
                    </Link>
                  ) : (
                    <span className="block font-semibold text-foreground">
                      {report.patient_label}
                    </span>
                  )}
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {report.report_type_label} / {report.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    作成 {formatDateTime(report.created_at)} / 更新{' '}
                    {formatDateTime(report.updated_at)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {report.status_label}
                  </span>
                </TableCell>
                <TableCell>
                  <CreatedReportStatusCell report={report} />
                </TableCell>
                <TableCell>
                  <Link
                    href={report.action.href}
                    className={cn(reportOutlineActionClassName, 'text-primary')}
                  >
                    {report.action.label}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function WorkspaceSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="報告・共有ワークスペース読み込み中">
      <div className="space-y-4">
        <Skeleton className="h-52 w-full rounded-lg" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

const REPORT_WORKSPACE_REFETCH_INTERVAL_MS = 60_000;

export function ReportShareWorkspace() {
  const orgId = useOrgId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isBootstrappingOrg = !orgId;

  const workspaceQuery = useQuery({
    queryKey: ['care-reports', 'today-workspace', orgId],
    queryFn: () => fetchReportsTodayWorkspace(orgId),
    enabled: !isBootstrappingOrg,
    refetchInterval: REPORT_WORKSPACE_REFETCH_INTERVAL_MS,
  });
  const cockpitQuery = useQuery({
    queryKey: ['dashboard', 'cockpit', orgId],
    queryFn: () => fetchOperationCockpit(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg && workspaceQuery.isSuccess,
  });
  const generateDraftMutation = useMutation({
    mutationFn: (input: DraftGenerationInput) =>
      generateCareReportFromVisit<GeneratedCareReport>(
        {
          orgId,
          visitRecordId: input.visitRecordId,
          expectedVisitRecordUpdatedAt: input.visitRecordUpdatedAt,
          reportType: input.reportType,
        },
        '下書きの作成に失敗しました',
      ),
    onSuccess: (reports) => {
      const firstReport = reports[0];
      if (!firstReport) {
        toast.error('下書きは作成されませんでした');
        return;
      }
      toast.success('報告書の下書きを作成しました');
      queryClient.invalidateQueries({ queryKey: ['care-reports', 'today-workspace', orgId] });
      queryClient.invalidateQueries({ queryKey: ['care-reports'] });
      router.push(buildReportHref(firstReport.id));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const now = new Date();
  const data = workspaceQuery.data ?? null;
  const cockpit = cockpitQuery.data ?? null;
  const actionRail =
    cockpitQuery.isLoading || cockpitQuery.isError ? (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        {cockpitQuery.isLoading ? (
          <div
            className="space-y-3"
            role="status"
            aria-label="オペレーション情報を読み込み中"
            data-testid="workspace-action-rail-loading"
          >
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <ErrorState
            variant="server"
            title="オペレーション情報を表示できません"
            description="止まっている理由の取得に失敗しました。再試行してください。"
            detail={cockpitQuery.error instanceof Error ? cockpitQuery.error.message : undefined}
            action={{ label: '再試行', onClick: () => void cockpitQuery.refetch() }}
          />
        )}
      </div>
    ) : (
      <WorkspaceActionRail
        nextAction={buildWorkspaceNextAction(cockpit)}
        blockedReasons={buildWorkspaceBlockedReasons(cockpit)}
        blockedReasonsEmptyLabel="止まっている作業はありません"
        evidence={buildReportEvidence(data)}
        evidenceOpenLabel="開く"
      />
    );

  return (
    <section aria-label="報告・共有ワークスペース" data-testid="report-share-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-foreground">報告・共有</h1>
          <p className="text-sm text-muted-foreground">
            {buildHeaderMeta(now, data?.counts ?? null, data?.count_metadata ?? null)}
          </p>
        </div>
        <Link
          href="/admin/document-templates"
          className={buttonVariants({
            variant: 'outline',
            className: '!h-auto !min-h-[44px] sm:!h-auto sm:!min-h-[44px]',
          })}
          data-testid="report-edit-templates"
        >
          テンプレートを編集
        </Link>
      </div>

      <div className="mt-4">
        {isBootstrappingOrg || workspaceQuery.isLoading ? (
          <WorkspaceSkeleton />
        ) : workspaceQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="報告・共有を表示できません"
              description="当日報告ワークスペースの集計取得に失敗しました。再試行してください。"
              detail={
                workspaceQuery.error instanceof Error ? workspaceQuery.error.message : undefined
              }
              action={{ label: '再試行', onClick: () => void workspaceQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            {/* p1: 次にやること/止まっている理由を fold 内へ。DOM/フォーカス順も rail→本文に
                統一し(モバイル優先=論理順、WCAG 2.4.3/1.3.2)、デスクトップは grid 配置で右 sticky 列へ。 */}
            <aside
              aria-label="次にやること・止まっている理由"
              className="lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1"
              data-testid="report-action-rail-slot"
            >
              {actionRail}
            </aside>
            <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
              <TodayDraftsCard
                data={data}
                onGenerateDraft={(input) => generateDraftMutation.mutate(input)}
                generatingDraftKey={
                  generateDraftMutation.isPending
                    ? generateDraftMutation.variables
                      ? `${generateDraftMutation.variables.visitRecordId}:${generateDraftMutation.variables.reportType}`
                      : null
                    : null
                }
                isGeneratingDraft={generateDraftMutation.isPending}
              />
              <MainWorkflowCompactNav
                currentSteps={['reports']}
                description="報告・共有は処方から訪問後報告までの主業務フローの終点です。前工程の訪問記録へ戻って根拠を確認できます。"
              />
              {/* 即時対応優先(guidelines §68-76): 今日書く → 返信待ち(=止まっている/他職種待ち) →
                  残課題 → 作成済(参照)。返信待ちを上位へ繰り上げて判断を先に出す。 */}
              <WaitingBoxesSection data={data} />
              <ReportOpenIssuesSection
                issues={data.open_issues}
                count={data.count_metadata?.open_issues}
              />
              <CreatedReportsSection
                reports={data.created_reports}
                count={data.count_metadata?.created}
              />
              <p
                className="rounded-lg border-l-4 border-border/70 border-l-tag-info bg-card px-4 py-3 text-sm leading-6 text-tag-info"
                data-testid="report-template-policy-bar"
              >
                テンプレートは宛先ごとに自動選択されます(医師向け/ケアマネ向け/施設向け)。印象ではなく事実を書く構成です:
                実施したこと → 観察したこと → 提案。
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
