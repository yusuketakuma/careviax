import type { Metadata } from 'next';
import { getPatientEditShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { buildPatientHref } from '@/lib/patient/navigation';
import { PatientEditContent } from './patient-edit-content';

export const metadata: Metadata = {
  title: '患者情報編集 — PH-OS',
};

export default async function PatientEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref={buildPatientHref(id)}
        backLabel="患者詳細へ戻る"
        eyebrow="Patient Edit"
        title="患者情報編集"
        description="患者基本情報、紹介受付票、訪問初期情報をまとめて更新します。"
        shortcuts={getPatientEditShortcutLinks(id)}
        className="mb-4"
      />

      <PatientEditContent patientId={id} />
    </PageScaffold>
  );
}
