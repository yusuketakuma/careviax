import { Suspense } from 'react';
import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getReportsOverviewShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { ReportDeliveryDashboard } from './report-delivery-dashboard';
import { ReportShareWorkspace } from './report-share-workspace';
import { ReportsTable } from './reports-table';
import { TracingReportsTable } from './tracing-reports-table';
import { ReportsPageClient as PhosReportsPageClient } from '@/phos/ui/report/ReportsPageClient';
import { Loading } from '@/components/ui/loading';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { readReportsState } from './reports-query-state';

export const metadata: Metadata = { title: '報告・共有 — PH-OS' };

const PHOS_PROXY_API_BASE_URL = '/api/phos';

type ReportsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * /reports。ビューポート最上部は new_10_report の「報告・共有」ワークスペース
 * (今日書く報告 / 返信待ち / 今日解決した待ち + 右レール)。
 * 旧構成(報告書一覧・トレーシングレポート・送達分析)は機能温存のため
 * ビューポート下部(#report-classic-tools)へ残置する。
 */
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
    <PageScaffold variant="bare">
      {/* 新デザイン領域: 旧機能はこの下(ビューポート外)に温存する */}
      <div className="xl:min-h-[calc(100vh-4rem)]">
        <ReportShareWorkspace />
      </div>

      <section
        id="report-classic-tools"
        aria-label="報告書の一覧・送達分析(全機能)"
        className="space-y-4"
      >
        <div className="rounded-xl border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(34,113,177,0.10),transparent_35%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_24%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] px-5 py-5 shadow-sm sm:px-6 sm:py-6">
          <WorkflowPageHeader
            eyebrow="Care Reports"
            title="報告書の一覧・送達分析"
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
        </div>
        {contextSummary ? (
          <Alert
            className="border-sky-200 bg-sky-50 text-sky-900"
            data-testid="reports-context-banner"
          >
            <AlertDescription className="text-sky-800">{contextSummary}</AlertDescription>
          </Alert>
        ) : null}
        <PhosReportsPageClient apiBaseUrl={PHOS_PROXY_API_BASE_URL} />
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
      </section>
    </PageScaffold>
  );
}
