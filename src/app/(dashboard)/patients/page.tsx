import { Suspense } from 'react';
import { UserPlus } from 'lucide-react';
import { PatientsTable } from './patients-table';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import type { InitialPatientFilters } from './patients-table';

type PatientsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readString(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

function parseCaseStatus(value: string | null) {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export default async function PatientsPage({ searchParams }: PatientsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialFilters: InitialPatientFilters = {
    searchQuery: readString(resolvedSearchParams?.q) ?? '',
    caseStatusFilters: parseCaseStatus(readString(resolvedSearchParams?.case_status)),
    riskFilter: readString(resolvedSearchParams?.risk_level) ?? '_all',
    facilityFilter:
      readString(resolvedSearchParams?.facility_mode) ??
      readString(resolvedSearchParams?.building_id) ??
      '_all',
    consentFilter: readString(resolvedSearchParams?.consent_status) ?? '_all',
    pharmacistFilter: readString(resolvedSearchParams?.primary_pharmacist_id) ?? '_all',
    billingSupportFilter: readString(resolvedSearchParams?.billing_support) ?? '_all',
    payerFilter: readString(resolvedSearchParams?.payer_basis) ?? '_all',
    lastVisitFrom: readString(resolvedSearchParams?.last_visit_from) ?? '',
    lastVisitTo: readString(resolvedSearchParams?.last_visit_to) ?? '',
    readinessIssueFilter: readString(resolvedSearchParams?.readiness_issue) ?? '_all',
  };

  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Patient Registry"
        title="患者一覧"
        description="同意不足、高リスク、初回予定を先に見つけて、患者詳細や処方受付へつなげる一覧です。"
        action={{
          href: '/patients/new',
          label: '新規登録',
          icon: <UserPlus className="size-4" aria-hidden="true" />,
        }}
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              リスク、ケース状態、同意不足を上段で絞り込み、そのまま患者詳細や訪問準備へ進めます。
            </p>
          </div>
        }
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/prescriptions', label: '処方受付' },
            { href: '/schedules', label: 'スケジュール' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <PatientsTable initialFilters={initialFilters} />
      </Suspense>
    </PageScaffold>
  );
}
