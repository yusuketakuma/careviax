import { type Metadata } from 'next';
import { PrescriptionIntakeForm } from './prescription-intake-form';

export const metadata: Metadata = {
  title: '新規処方受付 — CareViaX',
};

export default function NewPrescriptionPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">新規処方受付</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          処方箋を受け付け、調剤ワークフローを開始します
        </p>
      </div>
      <PrescriptionIntakeForm />
    </div>
  );
}
