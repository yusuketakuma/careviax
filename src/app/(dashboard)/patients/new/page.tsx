import { Metadata } from 'next';
import { getPatientNewShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PatientForm } from '@/components/features/patients/patient-form';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '患者新規登録 — CareViaX',
};

export default function NewPatientPage() {
  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/patients"
        backLabel="患者一覧へ戻る"
        eyebrow="Patient Intake"
        title="患者新規登録"
        description="患者の基本情報を登録し、紹介受付や処方受付へつなげます。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">登録の考え方</p>
            <p className="text-sm text-muted-foreground">
              まず患者の基本情報を確定し、その後に紹介、ケース開始、処方受付へつなげます。
            </p>
          </div>
        }
        shortcuts={getPatientNewShortcutLinks()}
        className="mb-6"
      />

      <div className="mx-auto max-w-3xl">
        <PatientForm redirectTo="/patients" />
      </div>
    </PageScaffold>
  );
}
