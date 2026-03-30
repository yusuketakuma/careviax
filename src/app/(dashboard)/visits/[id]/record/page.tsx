import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { VisitRecordForm } from './visit-record-form';

export const metadata: Metadata = {
  title: '訪問記録入力 — CareViaX',
};

export default async function VisitRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <Link
          href="/visits"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          訪問一覧へ戻る
        </Link>
      </div>

      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">訪問記録入力</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          SOAP形式で訪問内容を記録します
        </p>
      </div>

      <VisitRecordForm id={id} />
    </div>
  );
}
