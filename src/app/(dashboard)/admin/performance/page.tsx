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
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';

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
  patient_contact_status: 'pending' | 'attempted' | 'confirmed' | 'declined' | 'unreachable';
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

function kpiToneClass(value: number, target: number, reverse = false) {
  const good = reverse ? value <= target : value >= target;
  return good
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';
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
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
            {value}
            {unit ? <span className="ml-1 text-sm text-muted-foreground">{unit}</span> : null}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
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

  const workflowQuery = useQuery({
    queryKey: ['admin-performance-workflow', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/workflow', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ワークフローの取得に失敗しました');
      return res.json() as Promise<{ data: WorkflowData }>;
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const schedulesQuery = useQuery({
    queryKey: ['admin-performance-schedules', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: dateFrom,
        date_to: dateTo,
        limit: '200',
      });
      const res = await fetch(`/api/visit-schedules?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問予定の取得に失敗しました');
      return res.json() as Promise<{ data: VisitSchedule[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const proposalsQuery = useQuery({
    queryKey: ['admin-performance-proposals', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: dateFrom,
        date_to: dateTo,
      });
      const res = await fetch(`/api/visit-schedule-proposals?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問候補の取得に失敗しました');
      return res.json() as Promise<{ data: Proposal[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const workflow = workflowQuery.data?.data;
  const schedules = useMemo(() => schedulesQuery.data?.data ?? [], [schedulesQuery.data]);
  const proposals = useMemo(() => proposalsQuery.data?.data ?? [], [proposalsQuery.data]);

  const performance = useMemo(() => {
    const lockedSchedules = schedules.filter((schedule) => Boolean(schedule.confirmed_at)).length;
    const pendingOverrides = schedules.filter(
      (schedule) => schedule.override_request?.status === 'pending'
    ).length;
    const emergencyItems =
      schedules.filter((schedule) => schedule.priority === 'emergency').length +
      proposals.filter((proposal) => proposal.priority === 'emergency').length;
    const fallbackAssignments =
      schedules.filter((schedule) => schedule.assignment_mode === 'fallback').length +
      proposals.filter((proposal) => proposal.assignment_mode === 'fallback').length;
    const contactConfirmed = proposals.filter(
      (proposal) => proposal.patient_contact_status === 'confirmed'
    ).length;
    const avgRouteScore = proposals.length
      ? Math.round(
          (proposals.reduce((sum, proposal) => sum + (proposal.route_distance_score ?? 0), 0) /
            proposals.length) *
            10
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
    [proposals]
  );

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-none bg-[linear-gradient(135deg,rgba(248,250,252,1),rgba(236,253,245,1))] ring-1 ring-slate-200">
        <CardContent className="grid gap-5 px-5 py-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Operational Performance
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              ルート確定率と変更負荷をそのまま業務指標にする
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              訪問ロック、変更承認待ち、緊急影響、電話確認率を同じ画面で追い、
              現場の詰まりがどこにあるかを可視化します。
            </p>
          </div>
          <div className="grid gap-2 rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">対象期間</span>
              <span className="font-medium text-slate-900">
                {format(weekStart, 'M/d', { locale: ja })} - {format(weekEnd, 'M/d', { locale: ja })}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">計測更新</span>
              <span className="font-medium text-slate-900">30秒ごと</span>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              API 応答時間の代替ではなく、運用ボトルネックと処理密度の可視化です。
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">運用ボトルネック</CardTitle>
            <CardDescription>現場負荷の高い領域を短く要約します</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {performance.pendingOverrides > 0 && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                確定済み予定の変更承認が {performance.pendingOverrides} 件あります。
              </p>
            )}
            {performance.emergencyItems > 0 && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
                緊急訪問・割込対応の影響が {performance.emergencyItems} 件あります。
              </p>
            )}
            {performance.avgRouteScore > 0 && (
              <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sky-800">
                平均移動スコアは {performance.avgRouteScore.toFixed(1)} です。
              </p>
            )}
            {(workflow?.workload_metrics.pharmacists ?? []).length > 0 && (
              <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
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
            {topProposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">対象期間の訪問候補はありません</p>
            ) : (
              topProposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3"
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
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
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
                size="sm"
                onClick={() => {
                  void workflowQuery.refetch();
                  void schedulesQuery.refetch();
                  void proposalsQuery.refetch();
                }}
              >
                <RefreshCw className="mr-2 size-4" aria-hidden="true" />
                更新
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
