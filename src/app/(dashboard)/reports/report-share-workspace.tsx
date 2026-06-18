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
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type {
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
  critical: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
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

type GeneratedCareReport = {
  id: string;
  report_type: string;
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

function displayFailureReason(reason: string | null): string | null {
  if (
    reason === 'メール送信に失敗しました' ||
    reason === '送付に失敗しました' ||
    reason === '外部送信に失敗しました'
  ) {
    return reason;
  }
  return null;
}

async function fetchReportsTodayWorkspace(orgId: string): Promise<ReportsTodayWorkspaceResponse> {
  const res = await fetch('/api/care-reports/today-workspace', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('報告ワークスペースの取得に失敗しました');
  const json = await res.json();
  return json.data;
}

async function fetchOperationCockpit(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('当日オペレーション情報の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

async function generateCareReportDraftFromVisit(
  orgId: string,
  visitRecordId: string,
): Promise<GeneratedCareReport[]> {
  const res = await fetch('/api/care-reports/generate-from-visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
    body: JSON.stringify({ visit_record_id: visitRecordId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error((err as { message?: string } | null)?.message ?? '下書きの作成に失敗しました');
  }
  const json = (await res.json()) as { data?: GeneratedCareReport[] };
  return json.data ?? [];
}

// ---------------------------------------------------------------------------
// 今日書く報告
// ---------------------------------------------------------------------------

function TodayDraftsCard({
  data,
  onGenerateDraft,
  generatingVisitRecordId,
  isGeneratingDraft,
}: {
  data: ReportsTodayWorkspaceResponse;
  onGenerateDraft: (visitRecordId: string) => void;
  generatingVisitRecordId: string | null;
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
        <Table className="mt-3">
          <TableHeader>
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
          <TableBody>
            {data.draft_rows.map((row) => (
              <TableRow key={row.id} data-testid="report-draft-row">
                <TableCell className="font-semibold tabular-nums text-foreground">
                  {row.time_start ? formatTimeOfDay(row.time_start) : '--:--'}
                </TableCell>
                <TableCell className="font-medium text-foreground">{row.patient_label}</TableCell>
                <TableCell className="text-foreground">{row.recipient_label}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {DRAFT_STATUS_LABELS[row.status] ?? row.status}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    {row.note ? (
                      // 危険区分メモ(麻薬使用状況を含む 等)は隠さず常時表示する
                      <span className="text-xs text-muted-foreground">{row.note}</span>
                    ) : null}
                    {row.action ? (
                      <Link
                        href={row.action.href}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-medium text-primary hover:bg-primary/10 sm:min-h-8"
                      >
                        {row.action.label}
                      </Link>
                    ) : null}
                    {row.status === 'ready_to_generate' && row.visit_record_id ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onGenerateDraft(row.visit_record_id!)}
                        disabled={isGeneratingDraft}
                        aria-label={`${row.patient_label} ${row.recipient_label} の下書きを自動作成`}
                        className="px-3"
                      >
                        {generatingVisitRecordId === row.visit_record_id
                          ? '作成中...'
                          : '下書きを自動作成'}
                      </Button>
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
        <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
          {waitingBadgeLabel(reply.waiting_days)}
        </span>
        <p className="min-w-0 flex-1 text-sm font-bold leading-5 text-foreground">{reply.title}</p>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {reply.actions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'text-primary')}
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
          <span className="text-xs text-muted-foreground">{data.counts.waiting}件</span>
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
          <span className="text-xs text-muted-foreground">{data.counts.resolved}件</span>
        </div>
        {data.resolved_today.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">今日解決した待ちはまだありません。</p>
        ) : (
          <ul className="mt-3 space-y-2" role="list">
            {data.resolved_today.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3"
                data-testid="report-resolved-row"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    回答受領 {formatTimeOfDay(item.received_at)}
                  </span>
                  <p className="min-w-0 flex-1 text-sm font-bold leading-5 text-foreground">
                    {item.title}
                  </p>
                  <Link
                    href={item.action.href}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'shrink-0 text-primary',
                    )}
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

function ReportOpenIssuesSection({ issues }: { issues: ReportOpenIssue[] }) {
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
        <span className="text-xs text-muted-foreground">{issues.length}件</span>
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
                  'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold',
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
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'text-primary')}
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
    const failureReason = displayFailureReason(failedDelivery.failure_reason);
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">
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
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'mt-2 border-red-200 bg-white text-red-800 hover:bg-red-100',
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
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
        他職種未報告
      </span>
    );
  }

  return (
    <span className="space-y-1">
      <span className="block text-sm font-semibold text-emerald-700">他職種へ報告済み</span>
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

function CreatedReportsSection({ reports }: { reports: ReportCreatedRow[] }) {
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
        <span className="text-xs text-muted-foreground">{reports.length}件</span>
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
                  <span className="block font-semibold text-foreground">
                    {report.patient_label}
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {report.report_type_label} / {report.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    作成 {formatDateTime(report.created_at)} / 更新{' '}
                    {formatDateTime(report.updated_at)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {report.status_label}
                  </span>
                </TableCell>
                <TableCell>
                  <CreatedReportStatusCell report={report} />
                </TableCell>
                <TableCell>
                  <Link
                    href={report.action.href}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'text-primary',
                    )}
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
    mutationFn: (visitRecordId: string) => generateCareReportDraftFromVisit(orgId, visitRecordId),
    onSuccess: (reports) => {
      const firstReport = reports[0];
      if (!firstReport) {
        toast.error('下書きは作成されませんでした');
        return;
      }
      toast.success('報告書の下書きを作成しました');
      queryClient.invalidateQueries({ queryKey: ['care-reports', 'today-workspace', orgId] });
      queryClient.invalidateQueries({ queryKey: ['care-reports'] });
      router.push(`/reports/${firstReport.id}`);
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
          <h2 className="text-xl font-bold text-foreground">報告・共有</h2>
          <p className="text-sm text-muted-foreground">
            {buildHeaderMeta(now, data?.counts ?? null)}
          </p>
        </div>
        <Link
          href="/admin/document-templates"
          className={buttonVariants({ variant: 'outline' })}
          data-testid="report-edit-templates"
        >
          テンプレートを編集
        </Link>
      </div>

      <div className="mt-4">
        <MainWorkflowCompactNav
          currentSteps={['reports']}
          description="報告・共有は処方から訪問後報告までの主業務フローの終点です。前工程の訪問記録へ戻って根拠を確認できます。"
        />
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
          <div className="space-y-4">
            <div className="min-w-0 space-y-4">
              <TodayDraftsCard
                data={data}
                onGenerateDraft={(visitRecordId) => generateDraftMutation.mutate(visitRecordId)}
                generatingVisitRecordId={
                  generateDraftMutation.isPending ? generateDraftMutation.variables : null
                }
                isGeneratingDraft={generateDraftMutation.isPending}
              />
              <ReportOpenIssuesSection issues={data.open_issues} />
              <CreatedReportsSection reports={data.created_reports} />
              <WaitingBoxesSection data={data} />
              <p
                className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800"
                data-testid="report-template-policy-bar"
              >
                テンプレートは宛先ごとに自動選択されます(医師向け/ケアマネ向け/施設向け)。印象ではなく事実を書く構成です:
                実施したこと → 観察したこと → 提案。
              </p>
            </div>
            <div>{actionRail}</div>
          </div>
        )}
      </div>
    </section>
  );
}
