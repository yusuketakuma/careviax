import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { MedicationSetsContent } from './medication-sets-content';
import { SetWorkspace } from './set-workspace';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'セット — PH-OS',
};

/**
 * /medication-sets。ビューポート最上部は new_09_set のセット準備ワークスペース
 * (施設グルーピング・居室別テーブル・右レール)。旧 UI(セット対象患者 /
 * 計画候補 / 鑑査待ち一覧と計画作成・鑑査ダイアログ)は機能温存のため
 * ビューポート下部へ残置する。
 */
export default function MedicationSetsPage() {
  return (
    <PageScaffold variant="bare">
      <Suspense fallback={<Loading />}>
        <SetWorkspace />
      </Suspense>

      <section
        aria-label="セット計画・鑑査(従来ビュー)"
        className="rounded-xl border border-border/70 bg-card px-4 py-4 sm:px-6 sm:py-6"
      >
        <WorkflowPageHeader
          eyebrow="Medication Set"
          title="セット計画・鑑査(従来ビュー)"
          description="セット対象患者、セット計画、セット鑑査を同じテーマで確認し、訪問準備へ接続します。"
          supportingContent={
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">確認順序</p>
              <p className="text-sm text-muted-foreground">
                候補サイクル、計画作成、鑑査待ちを順に確認し、訪問準備へ漏れなく渡します。
              </p>
            </div>
          }
          mainWorkflowSteps={['medication_sets', 'set_audit']}
          mainWorkflowDescription="この画面はセット計画とセット監査の両工程をまとめて扱うため、4 と 5 を同時に強調しています。"
          childrenLabel="関連導線"
        >
          <PageShortcutLinks
            links={[
              { href: '/workflow', label: 'ワークフロー' },
              { href: '/schedules', label: 'スケジュール' },
            ]}
          />
        </WorkflowPageHeader>

        <div className="mt-4">
          <Suspense fallback={<Loading />}>
            <MedicationSetsContent />
          </Suspense>
        </div>
      </section>
    </PageScaffold>
  );
}
