import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { DispensingQueue } from './dispensing-queue';
import { DispenseWorkbench } from './dispense-workbench';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '調剤 — PH-OS',
};

/**
 * /dispensing。ビューポート最上部は new_07_dispense の 3 ペイン調剤ワークベンチ
 * (左キュー / いまの1件 / 右レール)。旧 DataTable キュー(優先度・施設・
 * キーボード操作・詳細入力 /dispensing/[taskId] への導線)は下部に温存する。
 */
export default function DispensingPage() {
  return (
    <PageScaffold variant="bare">
      <div className="rounded-xl border border-border/70 bg-background px-4 py-4 sm:px-6 sm:py-5">
        <Suspense fallback={<Loading />}>
          <DispenseWorkbench />
        </Suspense>
      </div>

      <div className="rounded-xl border border-border/70 bg-card px-4 py-4 sm:px-6 sm:py-6">
        <WorkflowPageHeader
          eyebrow="Dispensing"
          title="調剤キュー(全件一覧)"
          description="調剤待ちの処方を優先度順に表示し、次の監査工程へつなげるキューです。詳細入力(品目ごとの実績・代替薬・疑義照会)は患者名から開きます。"
          supportingContent={
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">確認順序</p>
              <p className="text-sm text-muted-foreground">
                緊急度、訪問先、疑義照会状況を上から確認し、調剤入力へ進みます。
              </p>
            </div>
          }
          mainWorkflowSteps={['dispensing']}
          childrenLabel="関連導線"
        >
          <PageShortcutLinks
            links={[
              { href: '/auditing', label: '監査' },
              { href: '/workflow', label: 'ワークフロー' },
            ]}
          />
        </WorkflowPageHeader>

        <Suspense fallback={<Loading />}>
          <DispensingQueue />
        </Suspense>
      </div>
    </PageScaffold>
  );
}
