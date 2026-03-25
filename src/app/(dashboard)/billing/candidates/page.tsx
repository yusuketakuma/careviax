import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Loading } from '@/components/ui/loading';
import { BillingCandidatesContent } from './billing-candidates-content';

export const metadata: Metadata = {
  title: '月次請求候補 — CareViaX',
};

export default function BillingCandidatesPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/billing"
          className="mb-4 inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          請求ダッシュボードへ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
          月次請求候補
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          算定候補の確認・バリデーション・CSV出力
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <BillingCandidatesContent />
      </Suspense>
    </div>
  );
}
