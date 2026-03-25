import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { AuditDetail } from './audit-detail';

export const metadata: Metadata = {
  title: '調剤鑑査詳細 — CareViaX',
};

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <Link
          href="/auditing"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          鑑査一覧へ戻る
        </Link>
      </div>

      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">調剤鑑査</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          処方原本・構造化明細・調剤実績を比較して鑑査を実施してください
        </p>
      </div>

      <AuditDetail taskId={taskId} />
    </div>
  );
}
