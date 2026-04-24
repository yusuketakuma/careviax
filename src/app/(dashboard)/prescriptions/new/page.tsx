import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PrescriptionIntakeForm } from './prescription-intake-form';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '新規処方受付 — CareViaX',
};

export default function NewPrescriptionPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Prescription Intake"
        title="新規処方受付"
        description="患者とケースを選び、QR下書き・原本・前回処方・他職種共有を確認してから下部の登録ボタンで調剤ワークフローを開始します"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">入力の流れ</p>
            <p className="text-sm text-muted-foreground">
              患者、ケース、処方情報を確定してから受付登録し、調剤ワークフローへ進みます。
            </p>
          </div>
        }
        mainWorkflowSteps={['prescriptions']}
        mainWorkflowDescription="新規受付の入力画面でも、主業務フロー上の現在地を見失わないようにしています。"
      >
        <PageShortcutLinks
          links={[
            { href: '/prescriptions', label: '処方受付一覧' },
            { href: '/prescriptions/qr-drafts', label: 'QR下書き' },
            { href: '/qr-scan', label: 'QRスキャン' },
            { href: '/patients', label: '患者一覧' },
            { href: '/workflow', label: 'ワークフロー' },
          ]}
        />
      </WorkflowPageHeader>
      <PrescriptionIntakeForm />
    </PageScaffold>
  );
}
