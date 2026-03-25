import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { ShiftsContent } from './shifts-content';

export const metadata: Metadata = {
  title: '薬剤師シフト管理 — CareViaX',
};

export default function ShiftsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          薬剤師シフト管理
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          月間シフトの確認・編集
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <ShiftsContent />
      </Suspense>
    </div>
  );
}
