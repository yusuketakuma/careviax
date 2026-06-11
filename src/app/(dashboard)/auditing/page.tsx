import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { AuditingQueue } from './auditing-queue';
import { AuditWorkbench } from './audit-workbench';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '監査 — PH-OS',
};

/**
 * /auditing。ビューポート最上部は new_08_audit の 3 ペイン監査ワークベンチ
 * (私の監査キュー / 二人制バナー+麻薬ダブルカウント / 右レール)。
 * 旧 DataTable キュー(保留・緊急例外承認を含む詳細 /auditing/[taskId] への導線)は
 * 下部に温存する。
 */
export default function AuditingPage() {
  return (
    <PageScaffold variant="bare">
      <div className="rounded-xl border border-border/70 bg-background px-4 py-4 sm:px-6 sm:py-5">
        <Suspense fallback={<Loading />}>
          <AuditWorkbench />
        </Suspense>
      </div>

      <div className="rounded-xl border border-border/70 bg-card px-4 py-4 sm:px-6 sm:py-6">
        <WorkflowPageHeader
          eyebrow="Dispense Audit"
          title="監査キュー(全件一覧)"
          description="調剤済み処方の整合性と安全性を確認し、セット工程へ渡すための確認面です。保留・緊急例外承認は患者名から開く詳細画面で行います。"
          supportingContent={
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
              <p className="text-sm text-muted-foreground">
                差異、疑義照会、未承認件数を先に把握し、差戻しと合格の判断を揃えます。
              </p>
            </div>
          }
          mainWorkflowSteps={['auditing']}
          childrenLabel="関連導線"
        >
          <PageShortcutLinks
            links={[
              { href: '/dispensing', label: '調剤' },
              { href: '/medication-sets', label: 'セット管理' },
              { href: '/workflow', label: 'ワークフロー' },
            ]}
          />
        </WorkflowPageHeader>

        <Suspense fallback={<Loading />}>
          <AuditingQueue />
        </Suspense>
      </div>
    </PageScaffold>
  );
}
