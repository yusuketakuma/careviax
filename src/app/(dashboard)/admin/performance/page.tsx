'use client';

import type { ElementType } from 'react';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, endOfWeek, format, startOfWeek } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Route,
  ShieldAlert,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminPerformanceShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { HelpPopover } from '@/components/ui/help-popover';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import {
  SCHEDULE_WORKFLOW_INVALIDATION_EVENTS,
  WORKFLOW_DASHBOARD_INVALIDATION_EVENTS,
} from '@/lib/realtime/workflow-invalidation-policy';
import { StaffKpiPanel } from '@/app/(dashboard)/admin/staff/staff-kpi-panel';

type WorkflowData = {
  route_control: {
    locked_schedules: number;
    pending_override_requests: number;
    emergency_impact_items: number;
  };
  outcome_metrics: {
    completed_last_7_days: number;
    disrupted_last_7_days: number;
    urgent_completed_last_7_days: number;
    awaiting_reports: number;
    open_exceptions: number;
  };
  workload_metrics: {
    pharmacists: Array<{
      pharmacist_id: string;
      pharmacist_name: string;
      confirmed_visits: number;
      pending_tasks: number;
      urgent_items: number;
      callback_followups: number;
      facility_clusters: number;
    }>;
  };
};

type VisitSchedule = {
  id: string;
  scheduled_date: string;
  priority: 'normal' | 'urgent' | 'emergency';
  assignment_mode: 'primary' | 'fallback';
  confirmed_at: string | null;
  case_: {
    patient: {
      name: string;
    };
  };
  override_request: {
    status: 'pending' | 'completed' | 'cancelled';
    reason: string;
  } | null;
};

type Proposal = {
  id: string;
  proposed_date: string;
  priority: 'normal' | 'urgent' | 'emergency';
  proposal_status:
    | 'proposed'
    | 'patient_contact_pending'
    | 'confirmed'
    | 'rejected'
    | 'superseded'
    | 'expired'
    | 'reschedule_pending';
  patient_contact_status:
    | 'pending'
    | 'attempted'
    | 'confirmed'
    | 'declined'
    | 'change_requested'
    | 'unreachable';
  assignment_mode: 'primary' | 'fallback';
  route_distance_score: number | null;
  proposal_reason: string;
  visit_deadline_date: string | null;
  case_: {
    patient: {
      name: string;
    };
  };
};

type RuntimePerformanceSnapshot = {
  scope: 'current-process';
  target_ms: number;
  collected_since: string;
  summary: {
    route_count: number;
    total_requests: number;
    slow_requests: number;
    error_requests: number;
    slow_request_rate: number;
    overall_p50_ms: number;
    overall_p95_ms: number;
    overall_p99_ms: number;
    overall_p95_payload_bytes: number | null;
    overall_p95_query_count: number | null;
    critical_routes: number;
    payload_budgeted_routes: number;
    routes_over_payload_budget: number;
    routes_with_unconfigured_payload_budget: number;
    routes_over_target: number;
  };
  routes: Array<{
    route: string;
    method: string;
    org_scope: 'with_org' | 'without_org' | 'mixed';
    critical_route: boolean;
    critical_route_family: string | null;
    request_count: number;
    error_count: number;
    slow_count: number;
    slow_rate: number;
    average_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    max_ms: number;
    payload_sample_count: number;
    average_payload_bytes: number | null;
    p95_payload_bytes: number | null;
    max_payload_bytes: number | null;
    query_count_sample_count: number;
    average_query_count: number | null;
    p95_query_count: number | null;
    max_query_count: number | null;
    payload_budget_bytes: number | null;
    payload_budget_status: 'unconfigured' | 'unmeasured' | 'within_budget' | 'over_budget';
    payload_budget_met: boolean | null;
    payload_budget_over_count: number;
    last_seen_at: string | null;
    last_status: number | null;
    last_payload_bytes: number | null;
    target_met: boolean;
  }>;
};

function formatPayloadBudget(route: RuntimePerformanceSnapshot['routes'][number]) {
  if (route.payload_budget_bytes == null) return '未設定';
  const budget = `${route.payload_budget_bytes.toLocaleString()}B`;
  switch (route.payload_budget_status) {
    case 'within_budget':
      return `${budget}以内`;
    case 'over_budget':
      return `${budget}超過`;
    case 'unmeasured':
      return `${budget} / 未計測`;
    case 'unconfigured':
    default:
      return '未設定';
  }
}

function payloadBudgetBadge(route: RuntimePerformanceSnapshot['routes'][number]) {
  switch (route.payload_budget_status) {
    case 'within_budget':
      return { label: 'payload OK', variant: 'secondary' as const };
    case 'over_budget':
      return { label: 'payload over', variant: 'destructive' as const };
    case 'unmeasured':
      return { label: 'payload 未計測', variant: 'outline' as const };
    case 'unconfigured':
    default:
      return {
        label: route.critical_route ? 'payload 未設定' : 'payload 任意',
        variant: 'outline' as const,
      };
  }
}

// KPI 健全度: 目標達成=done(緑) / 未達=confirm(橙, 要対応)
function kpiToneClass(value: number, target: number, reverse = false) {
  const good = reverse ? value <= target : value >= target;
  return good
    ? 'border-state-done/30 bg-state-done/10 text-state-done'
    : 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm';
}

function KpiCard({
  title,
  value,
  description,
  unit,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number | string;
  description: string;
  unit?: string;
  icon: ElementType;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <HelpPopover title={title} description={description} />
          </div>
          <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
            {value}
            {unit ? <span className="ml-1 text-sm text-muted-foreground">{unit}</span> : null}
          </p>
        </div>
        <div className={`rounded-full border bg-background p-2 ${tone ?? 'border-border'}`}>
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PerformancePage() {
  const orgId = useOrgId();
  const weekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const weekEnd = useMemo(() => endOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 }), []);
  const dateFrom = format(weekStart, 'yyyy-MM-dd');
  const dateTo = format(weekEnd, 'yyyy-MM-dd');

  const workflowQuery = useRealtimeQuery({
    queryKey: ['admin-performance-workflow', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/workflow?view=performance', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: WorkflowData }>(res, 'ワークフローの取得に失敗しました');
    },
    enabled: !!orgId,
    invalidateOn: WORKFLOW_DASHBOARD_INVALIDATION_EVENTS,
    fallbackRefetchInterval: 60_000,
  });

  const schedulesQuery = useRealtimeQuery({
    queryKey: ['admin-performance-schedules', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: dateFrom,
        date_to: dateTo,
        limit: '200',
      });
      const res = await fetch(`/api/visit-schedules?${params}`, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: VisitSchedule[] }>(res, '訪問予定の取得に失敗しました');
    },
    enabled: !!orgId,
    invalidateOn: SCHEDULE_WORKFLOW_INVALIDATION_EVENTS,
    fallbackRefetchInterval: 60_000,
  });

  const proposalsQuery = useRealtimeQuery({
    queryKey: ['admin-performance-proposals', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: dateFrom,
        date_to: dateTo,
      });
      const res = await fetch(`/api/visit-schedule-proposals?${params}`, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: Proposal[] }>(res, '訪問候補の取得に失敗しました');
    },
    enabled: !!orgId,
    invalidateOn: SCHEDULE_WORKFLOW_INVALIDATION_EVENTS,
    fallbackRefetchInterval: 60_000,
  });

  const runtimeQuery = useQuery({
    queryKey: ['admin-performance-runtime', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/performance-metrics?top=6', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: RuntimePerformanceSnapshot }>(
        res,
        'API 応答指標の取得に失敗しました',
      );
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  const workflow = workflowQuery.data?.data;
  const schedules = useMemo(() => schedulesQuery.data?.data ?? [], [schedulesQuery.data]);
  const proposals = useMemo(() => proposalsQuery.data?.data ?? [], [proposalsQuery.data]);
  const runtime = runtimeQuery.data?.data;

  // 業務 KPI は workflow/schedules/proposals の集計。いずれか失敗時は 0 (false-zero) 表示せず ErrorState を出す。
  const metricsError = workflowQuery.isError || schedulesQuery.isError || proposalsQuery.isError;
  const refetchMetrics = () => {
    void workflowQuery.refetch();
    void schedulesQuery.refetch();
    void proposalsQuery.refetch();
  };

  const performance = useMemo(() => {
    const lockedSchedules = schedules.filter((schedule) => Boolean(schedule.confirmed_at)).length;
    const pendingOverrides = schedules.filter(
      (schedule) => schedule.override_request?.status === 'pending',
    ).length;
    const emergencyItems =
      schedules.filter((schedule) => schedule.priority === 'emergency').length +
      proposals.filter((proposal) => proposal.priority === 'emergency').length;
    const fallbackAssignments =
      schedules.filter((schedule) => schedule.assignment_mode === 'fallback').length +
      proposals.filter((proposal) => proposal.assignment_mode === 'fallback').length;
    const contactConfirmed = proposals.filter(
      (proposal) => proposal.patient_contact_status === 'confirmed',
    ).length;
    const avgRouteScore = proposals.length
      ? Math.round(
          (proposals.reduce((sum, proposal) => sum + (proposal.route_distance_score ?? 0), 0) /
            proposals.length) *
            10,
        ) / 10
      : 0;
    const routeLockRate = schedules.length
      ? Math.round((lockedSchedules / schedules.length) * 100)
      : 0;
    const phoneConfirmationRate = proposals.length
      ? Math.round((contactConfirmed / proposals.length) * 100)
      : 0;

    return {
      lockedSchedules,
      pendingOverrides,
      emergencyItems,
      fallbackAssignments,
      contactConfirmed,
      avgRouteScore,
      routeLockRate,
      phoneConfirmationRate,
    };
  }, [proposals, schedules]);

  const topProposals = useMemo(
    () =>
      [...proposals]
        .sort((left, right) => (right.route_distance_score ?? 0) - (left.route_distance_score ?? 0))
        .slice(0, 6),
    [proposals],
  );

  return (
    <PageScaffold variant="bare">
      <AdminPageHeader
        title="運用パフォーマンス"
        description="訪問制御、変更負荷、ルート確定率、API 遅延の主要運用指標を継続監視します。"
        shortcuts={getAdminPerformanceShortcutLinks()}
        supportingContent={null}
      />
      <section className="space-y-3" aria-labelledby="performance-action-signals">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="performance-action-signals" className="text-base font-semibold text-foreground">
            今すぐ見る要対応シグナル
          </h2>
          <div className="inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
            {format(weekStart, 'M/d', { locale: ja })} - {format(weekEnd, 'M/d', { locale: ja })} /
            60秒ごとに更新
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <div className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3">
            <p className="text-sm font-medium text-state-confirm">変更承認待ち</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
              {performance.pendingOverrides}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">専用リスケで処理</p>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-medium text-destructive">緊急影響</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
              {performance.emergencyItems}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">割込・緊急訪問</p>
          </div>
          <div className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3">
            <p className="text-sm font-medium text-state-confirm">API P95</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
              {runtime?.summary.overall_p95_ms ?? 0}
              <span className="ml-1 text-sm text-muted-foreground">ms</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">目標 {runtime?.target_ms ?? 500}ms</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-4 py-3">
            <p className="text-sm font-medium text-muted-foreground">閾値超過 route</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
              {runtime?.summary.routes_over_target ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">current-process</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-4 py-3 max-xl:col-span-2">
            <p className="text-sm font-medium text-muted-foreground">報告待ち</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
              {workflow?.outcome_metrics.awaiting_reports ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">訪問後の後続作業</p>
          </div>
        </div>
      </section>

      {metricsError ? (
        // 業務 KPI の元クエリ(workflow/schedules/proposals)失敗時は 0 (false-zero) を出さず ErrorState + 再読み込み。
        <ErrorState
          variant="server"
          size="inline"
          onRetry={refetchMetrics}
          retryLabel="再読み込み"
        />
      ) : (
        <section className="space-y-3" aria-labelledby="performance-workflow-kpis">
          <h2 id="performance-workflow-kpis" className="text-base font-semibold text-foreground">
            業務 KPI
          </h2>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard
              title="確定ロック件数"
              value={performance.lockedSchedules}
              description="電話確定済みの予定"
              icon={CheckCircle2}
              tone={kpiToneClass(performance.routeLockRate, 80)}
            />
            <KpiCard
              title="変更承認待ち"
              value={performance.pendingOverrides}
              description="専用リスケが必要な件数"
              icon={RefreshCw}
              tone={kpiToneClass(performance.pendingOverrides, 0, true)}
            />
            <KpiCard
              title="緊急影響"
              value={performance.emergencyItems}
              description="緊急訪問・割込影響の合算"
              icon={AlertTriangle}
              tone={kpiToneClass(performance.emergencyItems, 0, true)}
            />
            <KpiCard
              title="電話確認率"
              value={performance.phoneConfirmationRate}
              description="候補の電話確認済み比率"
              unit="%"
              icon={Route}
              tone={kpiToneClass(performance.phoneConfirmationRate, 80)}
            />
            <KpiCard
              title="平均ルート負荷"
              value={performance.avgRouteScore.toFixed(1)}
              description="候補の移動スコア平均"
              icon={TrendingUp}
            />
            <KpiCard
              title="代替割当"
              value={performance.fallbackAssignments}
              description="主担当以外の割当総数"
              icon={Users}
              tone={kpiToneClass(performance.fallbackAssignments, 0, true)}
            />
            <KpiCard
              title="確定率"
              value={performance.routeLockRate}
              description="対象期間の確定率"
              unit="%"
              icon={ShieldAlert}
              tone={kpiToneClass(performance.routeLockRate, 80)}
            />
            <KpiCard
              title="報告待ち"
              value={workflow?.outcome_metrics.awaiting_reports ?? 0}
              description="訪問後の後続作業"
              icon={AlertTriangle}
              tone={kpiToneClass(workflow?.outcome_metrics.awaiting_reports ?? 0, 0, true)}
            />
          </div>
        </section>
      )}

      {runtimeQuery.isError ? (
        // ランタイム指標(runtime)失敗時は 0 (false-zero) を出さず ErrorState + 再読み込み。
        <ErrorState
          variant="server"
          size="inline"
          onRetry={() => void runtimeQuery.refetch()}
          retryLabel="再読み込み"
        />
      ) : (
        <section className="space-y-3" aria-labelledby="performance-runtime-kpis">
          <h2 id="performance-runtime-kpis" className="text-base font-semibold text-foreground">
            API latency KPI
          </h2>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <KpiCard
              title="API P95"
              value={runtime?.summary.overall_p95_ms ?? 0}
              description="current-process の横断 P95"
              unit="ms"
              icon={Timer}
              tone={kpiToneClass(
                runtime?.summary.overall_p95_ms ?? 0,
                runtime?.target_ms ?? 500,
                true,
              )}
            />
            <KpiCard
              title="API P50"
              value={runtime?.summary.overall_p50_ms ?? 0}
              description="current-process の横断 P50"
              unit="ms"
              icon={TrendingUp}
            />
            <KpiCard
              title="閾値超過率"
              value={runtime?.summary.slow_request_rate ?? 0}
              description={`>${runtime?.target_ms ?? 500}ms の割合`}
              unit="%"
              icon={AlertTriangle}
              tone={kpiToneClass(runtime?.summary.slow_request_rate ?? 0, 5, true)}
            />
            <KpiCard
              title="閾値超過 route"
              value={runtime?.summary.routes_over_target ?? 0}
              description="P95 が目標を超える endpoint"
              icon={ShieldAlert}
              tone={kpiToneClass(runtime?.summary.routes_over_target ?? 0, 0, true)}
            />
            <KpiCard
              title="Query P95"
              value={
                runtime?.summary.overall_p95_query_count == null
                  ? '未計測'
                  : runtime.summary.overall_p95_query_count
              }
              description="route performance が記録した DB query count P95"
              icon={Route}
            />
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">運用ボトルネック</CardTitle>
            <CardDescription>現場負荷の高い領域を短く要約します</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {performance.pendingOverrides > 0 && (
              <p className="rounded-xl border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-state-confirm">
                確定済み予定の変更承認が {performance.pendingOverrides} 件あります。
              </p>
            )}
            {performance.emergencyItems > 0 && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
                緊急訪問・割込対応の影響が {performance.emergencyItems} 件あります。
              </p>
            )}
            {performance.avgRouteScore > 0 && (
              <p className="rounded-xl border-l-4 border-border/70 border-l-tag-info bg-card px-3 py-2 text-tag-info">
                平均移動スコアは {performance.avgRouteScore.toFixed(1)} です。
              </p>
            )}
            {(workflow?.workload_metrics.pharmacists ?? []).length > 0 && (
              <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  薬剤師負荷上位
                </p>
                {workflow?.workload_metrics.pharmacists.slice(0, 4).map((pharmacist) => (
                  <div
                    key={pharmacist.pharmacist_id}
                    className="flex items-center justify-between gap-3 border-t border-border/60 py-2 first:border-t-0 first:pt-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {pharmacist.pharmacist_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        確定 {pharmacist.confirmed_visits} / 代替 {pharmacist.urgent_items} / 再架電{' '}
                        {pharmacist.callback_followups}
                      </p>
                    </div>
                    <Badge variant="outline">{pharmacist.pending_tasks} 件タスク</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ルート候補と確定状態</CardTitle>
            <CardDescription>移動負荷の高い候補とロック状況を確認します</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {proposalsQuery.isError ? (
              // 取得失敗時は空状態（false-empty）にせず、再読み込み導線つきの ErrorState を出す。
              <ErrorState
                variant="server"
                size="inline"
                onRetry={() => void proposalsQuery.refetch()}
                retryLabel="再読み込み"
              />
            ) : topProposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">対象期間の訪問候補はありません</p>
            ) : (
              topProposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="space-y-2 rounded-lg border border-border/70 bg-muted/20 px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {proposal.priority === 'emergency'
                            ? '緊急'
                            : proposal.priority === 'urgent'
                              ? '至急'
                              : '通常'}
                        </Badge>
                        <Badge variant="secondary">
                          {proposal.assignment_mode === 'fallback' ? '代替割当' : '主担当'}
                        </Badge>
                        <Badge variant="outline">
                          {proposal.proposal_status === 'confirmed'
                            ? '確定'
                            : proposal.proposal_status === 'patient_contact_pending'
                              ? '架電待ち'
                              : proposal.proposal_status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {proposal.case_.patient.name}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {proposal.route_distance_score?.toFixed(1) ?? '0.0'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {proposal.proposal_reason
                      .split(' / ')
                      .slice(0, 4)
                      .filter(Boolean)
                      .map((part) => (
                        <span
                          key={part}
                          className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                        >
                          {part}
                        </span>
                      ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {proposal.patient_contact_status === 'confirmed'
                      ? '患者電話確認済み'
                      : proposal.patient_contact_status === 'declined'
                        ? '患者辞退'
                        : proposal.patient_contact_status === 'change_requested'
                          ? '変更希望'
                          : proposal.patient_contact_status === 'unreachable'
                            ? '不通'
                            : '確認待ち'}
                  </p>
                </div>
              ))
            )}
            <div className="flex justify-end">
              <Button
                variant="outline"
                className="!h-11 !min-h-11"
                onClick={() => {
                  void workflowQuery.refetch();
                  void schedulesQuery.refetch();
                  void proposalsQuery.refetch();
                  void runtimeQuery.refetch();
                }}
              >
                <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                更新
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">薬剤師別 KPI と負荷バランス</CardTitle>
          <CardDescription>
            月間訪問数、担当患者数、提出率、勤務日数から偏りを確認します
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 [&_button]:!h-11 [&_button]:!min-h-11 [&_input]:!h-11 [&_input]:!min-h-11">
          <StaffKpiPanel />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">API latency snapshot</CardTitle>
            <CardDescription>
              current-process のみを集計します。複数ノード環境の合算ではありません。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {runtimeQuery.isError ? (
              // 取得失敗時はサマリ数値(未計測/0 = false-zero)を一切出さず、ErrorState のみを出す。
              <ErrorState
                variant="server"
                size="inline"
                onRetry={() => void runtimeQuery.refetch()}
                retryLabel="再読み込み"
              />
            ) : (
              <>
                <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">収集開始</span>
                    <span className="font-medium text-foreground">
                      {runtime?.collected_since
                        ? format(new Date(runtime.collected_since), 'M/d HH:mm', { locale: ja })
                        : '未計測'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">サンプル総数</span>
                    <span className="font-medium text-foreground">
                      {runtime?.summary.total_requests ?? 0}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">記録 route 数</span>
                    <span className="font-medium text-foreground">
                      {runtime?.summary.route_count ?? 0}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">5xx 件数</span>
                    <span className="font-medium text-foreground">
                      {runtime?.summary.error_requests ?? 0}
                    </span>
                  </div>
                </div>
                {(runtime?.summary.total_requests ?? 0) === 0 ? (
                  <p className="rounded-xl border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-state-confirm">
                    まだ API サンプルがありません。通常画面を操作すると current-process
                    の計測が蓄積されます。
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Slow endpoints</CardTitle>
            <CardDescription>現時点で P95 が高い route を上から確認します</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runtimeQuery.isError ? (
              // 取得失敗時は空状態（false-empty）にせず、再読み込み導線つきの ErrorState を出す。
              <ErrorState
                variant="server"
                size="inline"
                onRetry={() => void runtimeQuery.refetch()}
                retryLabel="再読み込み"
              />
            ) : (runtime?.routes.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                表示できる API latency sample はまだありません
              </p>
            ) : (
              runtime?.routes.map((route) => (
                <div
                  key={`${route.method}-${route.route}`}
                  className="space-y-2 rounded-lg border border-border/70 bg-muted/20 px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{route.method}</Badge>
                        <Badge variant={route.target_met ? 'secondary' : 'destructive'}>
                          {route.target_met ? 'latency OK' : 'latency over'}
                        </Badge>
                        <Badge variant={payloadBudgetBadge(route).variant}>
                          {payloadBudgetBadge(route).label}
                        </Badge>
                      </div>
                      <p className="mt-1 break-all text-sm font-semibold text-foreground">
                        {route.route}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>P95 {route.p95_ms}ms</p>
                      <p>P99 {route.p99_ms}ms</p>
                      <p>max {route.max_ms}ms</p>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-9">
                    <div>件数 {route.request_count}</div>
                    <div>平均 {route.average_ms}ms</div>
                    <div>超過率 {route.slow_rate}%</div>
                    <div>5xx {route.error_count}</div>
                    <div>org scope {route.org_scope}</div>
                    <div>
                      route family{' '}
                      {route.critical_route_family == null ? '通常' : route.critical_route_family}
                    </div>
                    <div>
                      payload P95{' '}
                      {route.p95_payload_bytes == null
                        ? '未計測'
                        : `${route.p95_payload_bytes.toLocaleString()}B`}
                    </div>
                    <div>
                      query P95{' '}
                      {route.p95_query_count == null
                        ? '未計測'
                        : route.p95_query_count.toLocaleString()}
                    </div>
                    <div>payload budget {formatPayloadBudget(route)}</div>
                  </div>
                </div>
              ))
            )}
            <div className="flex justify-end">
              <Button
                variant="outline"
                className="!h-11 !min-h-11"
                onClick={() => {
                  void runtimeQuery.refetch();
                }}
              >
                <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                Runtime再計測
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageScaffold>
  );
}
