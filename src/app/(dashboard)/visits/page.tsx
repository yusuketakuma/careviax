import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { VisitsTable } from './visits-table';
import { VisitsToday } from './visits-today';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '訪問 — PH-OS',
};

/**
 * /visits。ビューポート最上部は new_04_visit の「今日の訪問(出発前の準備チェック)」。
 * 旧構成(訪問記録一覧テーブル)は機能温存のためビューポート下部へ残置する。
 */
export default function VisitsPage() {
  return (
    <PageScaffold variant="bare">
      {/* new_04_visit: 今日の訪問・準備チェックビュー(主操作: 訪問モードを開始) */}
      <VisitsToday />

      {/* 旧構成(機能温存): 実施済み訪問記録の閲覧テーブルを下部に残置 */}
      <section
        id="visits-classic"
        aria-label="従来の訪問記録一覧(実施記録の閲覧)"
        className="space-y-4"
      >
        <div className="rounded-xl border border-border bg-[radial-gradient(circle_at_top_left,rgba(34,113,177,0.10),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_26%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] px-6 py-5">
          <WorkflowPageHeader
            className="mb-0 space-y-0"
            eyebrow="Visit Records"
            title="訪問記録一覧"
            description="在宅訪問の実施記録を確認し、報告書作成や次回対応へつなげる一覧です。"
            supportingContent={
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
                <p className="text-sm text-muted-foreground">
                  当日の実施状況、未完了記録、報告書化が必要な訪問を先に確認します。
                </p>
              </div>
            }
            mainWorkflowSteps={['visits']}
            childrenLabel="関連導線"
          >
            <PageShortcutLinks
              links={[
                { href: '/schedules', label: 'スケジュール' },
                { href: '/reports', label: '報告書' },
              ]}
            />
          </WorkflowPageHeader>
        </div>

        <Suspense fallback={<Loading />}>
          <VisitsTable />
        </Suspense>
      </section>
    </PageScaffold>
  );
}
