import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { VisitsTable } from './visits-table';

export const metadata: Metadata = {
  title: '訪問記録一覧 — CareViaX',
};

export default function VisitsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">訪問記録一覧</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          在宅訪問の実施記録を確認します
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <VisitsTable />
      </Suspense>
    </div>
  );
}
