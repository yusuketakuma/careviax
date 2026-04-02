import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PrescriptionIntakeForm } from './prescription-intake-form';

export const metadata: Metadata = {
  title: '新規処方受付 — CareViaX',
};

export default function NewPrescriptionPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <WorkflowPageHeader
        title="新規処方受付"
        description="患者とケースを選び、原本・明細を確認してから下部の登録ボタンで調剤ワークフローを開始します"
      >
        <PageShortcutLinks
          links={[
            { href: '/prescriptions', label: '処方受付一覧' },
            { href: '/patients', label: '患者一覧' },
            { href: '/workflow', label: 'ワークフロー' },
          ]}
        />
      </WorkflowPageHeader>
      <PrescriptionIntakeForm />
    </div>
  );
}
