import { Metadata } from 'next';
import { getPatientConsentShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { ConsentRecordsContent } from './consent-records-content';

export const metadata: Metadata = {
  title: '同意記録 — CareViaX',
};

export default async function ConsentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-6">
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        title="同意記録"
        description="同意の取得状況、期限、撤回を患者文脈で追跡します。"
        shortcuts={getPatientConsentShortcutLinks(id)}
      />

      <ConsentRecordsContent />
    </div>
  );
}
