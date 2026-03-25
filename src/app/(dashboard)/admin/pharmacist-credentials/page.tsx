import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PharmacistCredentialsContent } from './pharmacist-credentials-content';

export const metadata: Metadata = {
  title: 'かかりつけ薬剤師管理 — CareViaX',
};

export default function PharmacistCredentialsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          かかりつけ薬剤師管理
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          研修認定・有効期限・勤務実績の管理
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <PharmacistCredentialsContent />
      </Suspense>
    </div>
  );
}
