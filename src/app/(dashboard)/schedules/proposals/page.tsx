import { Metadata } from 'next';
import { getScheduleProposalShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { ScheduleProposalsContent } from './schedule-proposals-content';
import { ScheduleWeeklyOptimizer } from './schedule-weekly-optimizer';
import { WorkflowPhasePanel } from '@/components/features/workflow/workflow-phase-panel';
import { PageScaffold } from '@/components/layout/page-scaffold';
import {
  readScheduleProposalDashboardState,
  readScheduleProposalOptimizerState,
  readScheduleProposalWorkspace,
} from './proposal-query-state';
import { ScheduleProposalWorkspaceTabs } from './schedule-proposal-workspace-tabs';

export const metadata: Metadata = {
  title: '訪問候補ダッシュボード — CareViaX',
};

type ScheduleProposalsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ScheduleProposalsPage({ searchParams }: ScheduleProposalsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const workspace = readScheduleProposalWorkspace(resolvedSearchParams);
  const dashboardState = readScheduleProposalDashboardState(resolvedSearchParams);
  const optimizerState = readScheduleProposalOptimizerState(resolvedSearchParams);

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/schedules"
        backLabel="スケジュールへ戻る"
        eyebrow="Schedule Proposals"
        title="訪問候補ダッシュボード"
        description="自動提案、患者連絡、再提案、確定までをこの画面で処理します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              承認待ち、患者連絡、再提案、確定済みを横断しながら候補処理を進めます。
            </p>
          </div>
        }
        shortcuts={getScheduleProposalShortcutLinks()}
        className="mb-0"
      />

      <WorkflowPhasePanel
        currentPhase="proposals"
        phaseKeys={['proposals', 'prescriptions', 'dispensing']}
        title="候補確定ショートカット"
        description="承認待ち、患者連絡、確定済みを横断して中断再開できます。"
      />

      <ScheduleProposalWorkspaceTabs
        activeWorkspace={workspace}
        searchParams={resolvedSearchParams}
      />

      {workspace === 'dashboard' ? (
        <ScheduleProposalsContent
          initialStatus={dashboardState.initialStatus}
          initialCaseId={dashboardState.initialCaseId}
          initialPatientId={dashboardState.initialPatientId}
          initialDateFrom={dashboardState.initialDateFrom}
          initialDateTo={dashboardState.initialDateTo}
          initialFocus={dashboardState.initialFocus}
          initialPreset={dashboardState.initialPreset}
          initialDetailId={dashboardState.initialDetailId}
          initialTravelMode={dashboardState.initialTravelMode}
        />
      ) : (
        <ScheduleWeeklyOptimizer
          initialDate={optimizerState.initialDate}
          initialCaseId={optimizerState.initialCaseId}
          initialVisitType={optimizerState.initialVisitType}
          initialPriority={optimizerState.initialPriority}
          initialTravelMode={optimizerState.initialTravelMode}
          initialPreferredTimeFrom={optimizerState.initialPreferredTimeFrom}
          initialPreferredTimeTo={optimizerState.initialPreferredTimeTo}
          initialRoutePharmacistId={optimizerState.initialRoutePharmacistId}
          initialRouteDate={optimizerState.initialRouteDate}
        />
      )}
    </PageScaffold>
  );
}
