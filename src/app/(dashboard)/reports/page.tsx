import { Suspense } from 'react';
import { type Metadata } from 'next';
import { ReportsTable } from './reports-table';
import { Loading } from '@/components/ui/loading';

export const metadata: Metadata = { title: '報告書一覧 — CareViaX' };

export default function ReportsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">報告書</h1>
        <p className="mt-1 text-sm text-muted-foreground">報告書の一覧と送付状態を管理します</p>
      </div>
      <Suspense fallback={<Loading />}>
        <ReportsTable />
      </Suspense>
    </div>
  );
}
