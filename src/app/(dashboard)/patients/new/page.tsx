import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PatientForm } from '@/components/features/patients/patient-form';

export const metadata: Metadata = {
  title: '患者新規登録 — CareViaX',
};

export default function NewPatientPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/patients"
          className="mb-4 inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          患者一覧へ戻る
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">患者新規登録</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          患者の基本情報を登録してください
        </p>
      </div>

      <div className="mx-auto max-w-2xl">
        <PatientForm redirectTo="/patients" />
      </div>
    </div>
  );
}
