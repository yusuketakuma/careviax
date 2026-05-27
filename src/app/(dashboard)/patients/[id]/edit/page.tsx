import type { Metadata } from 'next';
import { getPatientEditShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { PatientEditContent } from './patient-edit-content';

export const metadata: Metadata = {
  title: '患者情報編集 — PH-OS',
};

export default async function PatientEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        eyebrow="Patient Edit"
        title="患者情報編集"
        description="患者基本情報、紹介受付票、訪問初期情報をまとめて更新します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">編集の考え方</p>
            <p className="text-sm text-muted-foreground">
              患者詳細に散っていた入力項目を一括で見直し、紹介・訪問・服薬支援へ渡る基礎データを整えます。
            </p>
          </div>
        }
        shortcuts={getPatientEditShortcutLinks(id)}
        className="mb-6"
      />

      <PatientEditContent patientId={id} />
    </PageScaffold>
  );
}
