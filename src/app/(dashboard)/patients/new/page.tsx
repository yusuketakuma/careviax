import { Metadata } from 'next';
import { getPatientNewShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PatientForm } from '@/components/features/patients/patient-form';

export const metadata: Metadata = {
  title: '患者新規登録 — CareViaX',
};

export default function NewPatientPage() {
  return (
    <div className="p-6">
      <WorkflowPageIntro
        backHref="/patients"
        backLabel="患者一覧へ戻る"
        title="患者新規登録"
        description="患者の基本情報を登録し、紹介受付や処方受付へつなげます。"
        shortcuts={getPatientNewShortcutLinks()}
        className="mb-6"
      />

      <div className="mx-auto max-w-2xl">
        <PatientForm redirectTo="/patients" />
      </div>
    </div>
  );
}
