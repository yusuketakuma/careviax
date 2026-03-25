import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { VisitRecordDetail } from './visit-record-detail';

export const metadata: Metadata = {
  title: '訪問記録詳細 — CareViaX',
};

export default async function VisitRecordDetailPage({
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
          訪問記録一覧へ戻る
        </Link>
      </div>

      <VisitRecordDetail recordId={id} />
    </div>
  );
}
