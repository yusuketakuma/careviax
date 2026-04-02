import { Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getScheduleProposalShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { ScheduleProposalsContent } from './schedule-proposals-content';
import { ScheduleWeeklyOptimizer } from './schedule-weekly-optimizer';
import { WorkflowPhasePanel } from '@/components/features/workflow/workflow-phase-panel';

export const metadata: Metadata = {
  title: '訪問候補ダッシュボード — CareViaX',
};

type ScheduleProposalsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readString(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

export default async function ScheduleProposalsPage({
  searchParams,
}: ScheduleProposalsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-4">
        <WorkflowBackLink href="/schedules" label="スケジュールへ戻る" />
        <WorkflowPageHeader
          title="訪問候補ダッシュボード"
          description="自動提案、患者連絡、再提案、確定までをこの画面で処理します。"
          className="mb-0"
        >
          <PageShortcutLinks links={getScheduleProposalShortcutLinks()} />
        </WorkflowPageHeader>
      </div>

      <WorkflowPhasePanel
        currentPhase="proposals"
        phaseKeys={['proposals', 'prescriptions', 'dispensing']}
        title="候補確定ショートカット"
        description="承認待ち、患者連絡、確定済みを横断して中断再開できます。"
      />

      <ScheduleProposalsContent
        initialStatus={readString(resolvedSearchParams?.status)}
        initialCaseId={readString(resolvedSearchParams?.case_id)}
        initialPatientId={readString(resolvedSearchParams?.patient_id)}
        initialDate={readString(resolvedSearchParams?.date)}
        initialFocus={readString(resolvedSearchParams?.focus)}
      />

      <ScheduleWeeklyOptimizer
        initialDate={readString(resolvedSearchParams?.date)}
      />
    </div>
  );
}
