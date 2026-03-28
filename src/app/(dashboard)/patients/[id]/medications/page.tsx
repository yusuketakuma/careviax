import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft, FileText, Printer } from 'lucide-react';
import { Loading } from '@/components/ui/loading';
import { buttonVariants } from '@/components/ui/button';
import { PatientVisitBriefSection } from '@/components/visit-brief/patient-visit-brief-section';
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
        <div className="mt-4 flex gap-2 print:hidden">
          <Link
            href={`/api/patients/${id}/medications/pdf`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <FileText className="mr-1.5 size-4" aria-hidden="true" />
            PDFを開く
          </Link>
          <Link
            href={`/patients/${id}/medications/print`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Printer className="mr-1.5 size-4" aria-hidden="true" />
            印刷ビュー
          </Link>
        </div>
      </div>

      <div className="space-y-6">
        <Suspense fallback={<Loading />}>
          <PatientVisitBriefSection
            patientId={id}
            title="服薬管理サマリー"
            description="処方薬、調剤方法、直近共有を1画面で確認できます。"
          />
        </Suspense>

        <Suspense fallback={<Loading />}>
          <MedicationsContent patientId={id} />
        </Suspense>
      </div>
    </div>
  );
}
