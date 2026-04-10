'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ErrorState } from '@/components/ui/error-state';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { useAuthStore } from '@/lib/stores/auth-store';
import { type Proposal, type VisitSchedule } from '@/app/(dashboard)/schedules/day-view.shared';
import { fetchVisitSchedulesWindow } from '@/app/(dashboard)/schedules/visit-schedule-fetch.helpers';
import {
  buildHomeScheduleMetrics,
  filterCoordinationProposals,
  filterProposalsByReason,
  filterSchedulesByReason,
  filterSchedulesByScope,
  filterSchedulesByStatus,
  type HomeProposalReasonKey,
  type HomeProposalFilter,
  type HomeScheduleReasonKey,
  type HomeVisitStatusFilter,
  type HomeVisitScope,
  proposalNeedsCoordination,
  sortCoordinationProposals,
  sortHomeSchedules,
} from './home-schedule-board.helpers';
import { type DashboardFocusRole } from './dashboard-role-focus';
import {
  HomeCoordinationSection,
  HomeScheduleBoardSkeleton,
  HomeScheduleMetricsSection,
  HomeScheduleShortcutSection,
  HomeVisitsSection,
} from './home-schedule-board-sections';

async function fetchHomeProposals(
  orgId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Proposal[]> {
  const params = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
  });

  const response = await fetch(`/api/visit-schedule-proposals?${params.toString()}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!response.ok) throw new Error('訪問提案の取得に失敗しました');

  const payload = (await response.json()) as { data: Proposal[] };
  return payload.data ?? [];
}

export function HomeScheduleBoard({
  focusRole = 'common',
}: {
  focusRole?: DashboardFocusRole;
}) {
  const orgId = useOrgId();
  const currentUserId = useAuthStore((state) => state.currentUser.id);
  const [today, setToday] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [visitScope, setVisitScope] = useState<HomeVisitScope>(
    focusRole === 'pharmacist' ? 'mine' : 'all',
  );
  const [visitStatusFilter, setVisitStatusFilter] = useState<HomeVisitStatusFilter>('all');
  const [scheduleReasonFilter, setScheduleReasonFilter] = useState<HomeScheduleReasonKey | 'all'>('all');
  const [proposalFilter, setProposalFilter] = useState<HomeProposalFilter>(
    focusRole === 'clerk' ? 'pending' : 'all',
  );
  const [proposalReasonFilter, setProposalReasonFilter] = useState<HomeProposalReasonKey | 'all'>('all');
  const coordinationDateTo = useMemo(
    () => format(addDays(parseISO(`${today}T00:00:00`), 2), 'yyyy-MM-dd'),
    [today],
  );
  const isBootstrappingOrg = !orgId;

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const delay = nextMidnight.getTime() - now.getTime();

    const timeoutId = window.setTimeout(() => {
      setToday(format(new Date(), 'yyyy-MM-dd'));
    }, delay);

    return () => window.clearTimeout(timeoutId);
  }, [today]);

  const schedulesQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'home-schedules', orgId, today],
    queryFn: () =>
      fetchVisitSchedulesWindow<VisitSchedule>({
        orgId,
        dateFrom: today,
        dateTo: today,
        statusScope: 'active',
      }),
    enabled: !isBootstrappingOrg,
    staleTime: 60_000,
    invalidateOn: ['workflow_refresh'],
  });

  const proposalsQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'home-schedule-proposals', orgId, today, coordinationDateTo],
    queryFn: () => fetchHomeProposals(orgId, today, coordinationDateTo),
    enabled: !isBootstrappingOrg,
    staleTime: 60_000,
    invalidateOn: ['workflow_refresh'],
  });

  if (isBootstrappingOrg || (schedulesQuery.isLoading && proposalsQuery.isLoading)) {
    return <HomeScheduleBoardSkeleton />;
  }

  if (schedulesQuery.isError && proposalsQuery.isError) {
    return (
      <ErrorState
        variant="server"
        title="スケジュールボードを取得できません"
        description="今日の訪問予定と調整待ち提案の取得に失敗しました。再試行してください。"
        detail={
          schedulesQuery.error instanceof Error
            ? schedulesQuery.error.message
            : proposalsQuery.error instanceof Error
              ? proposalsQuery.error.message
              : undefined
        }
        action={{
          label: '再試行',
          onClick: () => {
            void schedulesQuery.refetch();
            void proposalsQuery.refetch();
          },
        }}
      />
    );
  }

  const allSchedules = sortHomeSchedules(schedulesQuery.data ?? []);
  const scopedSchedules = filterSchedulesByScope(allSchedules, visitScope, currentUserId);
  const statusScopedSchedules = filterSchedulesByStatus(scopedSchedules, visitStatusFilter);
  const schedules = filterSchedulesByReason(statusScopedSchedules, scheduleReasonFilter);
  const allCoordinationProposals = sortCoordinationProposals(
    (proposalsQuery.data ?? []).filter(proposalNeedsCoordination),
  );
  const proposalScopedItems = filterCoordinationProposals(allCoordinationProposals, proposalFilter);
  const coordinationProposals = filterProposalsByReason(proposalScopedItems, proposalReasonFilter);
  const metrics = buildHomeScheduleMetrics(schedules, allCoordinationProposals);

  return (
    <div className="space-y-4">
      {(schedulesQuery.isError || proposalsQuery.isError) && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            {schedulesQuery.isError && proposalsQuery.isError
              ? '予定と提案の一部取得に失敗しています。'
              : schedulesQuery.isError
                ? '訪問予定の取得に一部失敗しています。'
                : '提案一覧の取得に一部失敗しています。'}
          </AlertDescription>
        </Alert>
      )}

      <HomeScheduleMetricsSection focusRole={focusRole} metrics={metrics} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
        <HomeVisitsSection
          focusRole={focusRole}
          currentUserId={currentUserId}
          allSchedules={allSchedules}
          scopedSchedules={scopedSchedules}
          statusScopedSchedules={statusScopedSchedules}
          schedules={schedules}
          visitScope={visitScope}
          visitStatusFilter={visitStatusFilter}
          scheduleReasonFilter={scheduleReasonFilter}
          onVisitScopeChange={setVisitScope}
          onVisitStatusFilterChange={setVisitStatusFilter}
          onScheduleReasonFilterChange={setScheduleReasonFilter}
        />

        <div className="space-y-4">
          <HomeCoordinationSection
            focusRole={focusRole}
            allCoordinationProposals={allCoordinationProposals}
            proposalScopedItems={proposalScopedItems}
            coordinationProposals={coordinationProposals}
            proposalFilter={proposalFilter}
            proposalReasonFilter={proposalReasonFilter}
            onProposalFilterChange={setProposalFilter}
            onProposalReasonFilterChange={setProposalReasonFilter}
          />

          <HomeScheduleShortcutSection proposalFilter={proposalFilter} />
        </div>
      </div>
    </div>
  );
}
