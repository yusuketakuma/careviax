import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Loading } from '@/components/ui/loading';
import { SetAuditContent } from './set-audit-content';

export const metadata: Metadata = {
  title: 'セット鑑査 — CareViaX',
};

export default async function SetAuditPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/medication-sets"
          className="mb-4 inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          セット管理へ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
          セット鑑査
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          グリッド確認・部分承認・差戻し
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <SetAuditContent planId={planId} />
      </Suspense>
    </div>
  );
}
