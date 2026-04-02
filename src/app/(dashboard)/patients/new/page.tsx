import { Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getPatientNewShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PatientForm } from '@/components/features/patients/patient-form';

export const metadata: Metadata = {
  title: '患者新規登録 — CareViaX',
};

export default function NewPatientPage() {
  return (
    <div className="p-6">
      <div className="mb-4">
        <WorkflowBackLink href="/patients" label="患者一覧へ戻る" />
      </div>

      <WorkflowPageHeader
        title="患者新規登録"
        description="患者の基本情報を登録し、紹介受付や処方受付へつなげます。"
        className="mb-6"
      >
        <PageShortcutLinks links={getPatientNewShortcutLinks()} />
      </WorkflowPageHeader>

      <div className="mx-auto max-w-2xl">
        <PatientForm redirectTo="/patients" />
      </div>
    </div>
  );
}
