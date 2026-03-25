import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Loading } from '@/components/ui/loading';
import { MedicationSetFullContent } from './medication-set-full-content';

export const metadata: Metadata = {
  title: 'セット計画（詳細） — CareViaX',
};

export default function MedicationSetFullPage() {
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
          セット計画（詳細）
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          セット方式の選択・スロットグリッド確認・持参パック生成
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <MedicationSetFullContent />
      </Suspense>
    </div>
  );
}
