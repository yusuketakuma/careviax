import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { DispensingQueue } from './dispensing-queue';

export const metadata: Metadata = {
  title: '調剤キュー — CareViaX',
};

export default function DispensingPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">調剤キュー</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          調剤待ちの処方を優先度順に表示します
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <DispensingQueue />
      </Suspense>
    </div>
  );
}
