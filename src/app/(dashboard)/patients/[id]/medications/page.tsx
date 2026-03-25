import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Loading } from '@/components/ui/loading';
import { MedicationsContent } from './medications-content';

export const metadata: Metadata = {
  title: '服薬管理 — CareViaX',
};

export default async function MedicationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href={`/patients/${id}`}
          className="mb-4 inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          患者詳細へ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">服薬管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          服薬中薬剤・残薬記録を管理します
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <MedicationsContent patientId={id} />
      </Suspense>
    </div>
  );
}
