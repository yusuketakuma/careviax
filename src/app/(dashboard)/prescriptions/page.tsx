import { Suspense } from 'react';
import Link from 'next/link';
import { FilePlus } from 'lucide-react';
import { PrescriptionsTable } from './prescriptions-table';
import { Loading } from '@/components/ui/loading';
import { type Metadata } from 'next';

export const metadata: Metadata = {
  title: '処方箋受付一覧 — CareViaX',
};

export default function PrescriptionsPage() {
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">処方箋受付</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            受け付けた処方箋の一覧と状態を管理します
          </p>
        </div>
        <Link
          href="/prescriptions/new"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <FilePlus className="size-4" aria-hidden="true" />
          新規受付
        </Link>
      </div>

      <Suspense fallback={<Loading />}>
        <PrescriptionsTable />
      </Suspense>
    </div>
  );
}
