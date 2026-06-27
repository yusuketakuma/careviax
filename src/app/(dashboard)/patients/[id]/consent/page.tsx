import { Metadata } from 'next';
import { getPatientConsentShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { ConsentRecordsContent } from './consent-records-content';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { buildPatientHref } from '@/lib/patient/navigation';

export const metadata: Metadata = {
  title: '同意記録 — PH-OS',
};

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref={buildPatientHref(id)}
        backLabel="患者詳細へ戻る"
        eyebrow="Consent Records"
        title="同意記録"
        description="同意の取得状況、期限、撤回を患者文脈で追跡します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              現在有効な同意、期限切れ間近、撤回履歴を先に確認し、必要な更新へ進みます。
            </p>
          </div>
        }
        shortcuts={getPatientConsentShortcutLinks(id)}
      />

      <ConsentRecordsContent />
    </PageScaffold>
  );
}
