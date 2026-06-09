import { Suspense } from 'react';
import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getReportsOverviewShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { ReportDeliveryDashboard } from './report-delivery-dashboard';
import { ReportsTable } from './reports-table';
import { TracingReportsTable } from './tracing-reports-table';
import { ReportsPageClient as PhosReportsPageClient } from '@/phos/ui/report/ReportsPageClient';
import { Loading } from '@/components/ui/loading';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { readReportsState } from './reports-query-state';

export const metadata: Metadata = { title: '報告書一覧 — CareViaX' };

type ReportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readReportsState(resolvedSearchParams);
  const contextSummary =
    initialState.initialContext === 'dashboard_home'
      ? initialState.initialFocus === 'delivery'
        ? 'ホームから返信待ち・送達フォローにフォーカスして開いています。'
        : 'ホームから報告書一覧にフォーカスして開いています。'
      : null;

  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Care Reports"
        title="報告書"
        description="まず一覧から対象報告を開き、必要に応じて関連依頼や外部連携へ進みます。送達分析は一覧の下段でまとめて確認できます。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              送付待ち・返信待ちを上段で絞り込み、対象報告の本文確認後に送達分析で滞留を追います。
            </p>
          </div>
        }
        mainWorkflowSteps={['reports']}
        childrenLabel="関連導線"
      >
        <PageShortcutLinks links={getReportsOverviewShortcutLinks()} />
      </WorkflowPageHeader>
      {contextSummary ? (
        <Alert className="border-sky-200 bg-sky-50 text-sky-900" data-testid="reports-context-banner">
          <AlertDescription className="text-sky-800">{contextSummary}</AlertDescription>
        </Alert>
      ) : null}
      <PhosReportsPageClient apiBaseUrl={process.env.NEXT_PUBLIC_PHOS_API_BASE_URL} />
      <Suspense fallback={<Loading />}>
        <ReportsTable
          initialDeliveryStatus={initialState.initialDeliveryStatus}
          initialContext={initialState.initialContext}
          initialPatientId={initialState.initialPatientId}
          initialVisitRecordId={initialState.initialVisitRecordId}
        />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <TracingReportsTable />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <ReportDeliveryDashboard highlighted={initialState.initialFocus === 'delivery'} />
      </Suspense>
    </PageScaffold>
  );
}
