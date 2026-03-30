import { Metadata } from 'next';
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          訪問候補ダッシュボード
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          自動提案、患者連絡、再提案、確定までをこの画面で処理します。
        </p>
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
