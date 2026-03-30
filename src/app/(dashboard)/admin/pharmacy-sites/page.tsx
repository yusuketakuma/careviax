import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PharmacySitesContent } from './pharmacy-sites-content';

export const metadata: Metadata = {
  title: '薬局情報管理 — CareViaX',
};

export default function PharmacySitesPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">薬局情報管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          薬局の基本情報・届出フラグ・保険算定設定を管理します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <PharmacySitesContent />
      </Suspense>
    </div>
  );
}
