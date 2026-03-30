import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { InstitutionsContent } from './institutions-content';

export const metadata: Metadata = {
  title: '医療機関マスター — CareViaX',
};

export default function InstitutionsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">医療機関マスター</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          処方元医療機関を管理し、処方受付・疑義照会・報告書送付へ横展開します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <InstitutionsContent />
      </Suspense>
    </div>
  );
}
