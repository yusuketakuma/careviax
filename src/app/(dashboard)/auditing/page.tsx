import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { AuditingQueue } from './auditing-queue';

export const metadata: Metadata = {
  title: '調剤鑑査 — CareViaX',
};

export default function AuditingPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">調剤鑑査</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          調剤済みの処方を鑑査してください
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <AuditingQueue />
      </Suspense>
    </div>
  );
}
