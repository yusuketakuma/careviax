import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PatientDetailTabs } from './patient-detail-tabs';

export const metadata: Metadata = {
  title: '患者詳細 — CareViaX',
};

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
      </div>

      <PatientDetailTabs patientId={id} />
    </div>
  );
}
