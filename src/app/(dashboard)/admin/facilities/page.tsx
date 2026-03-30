import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { FacilitiesContent } from './facilities-content';

export const metadata: Metadata = {
  title: '施設マスター — CareViaX',
};

export default function FacilitiesPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">施設マスター</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          施設基本情報と連絡先を管理し、患者登録・訪問計画に利用します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <FacilitiesContent />
      </Suspense>
    </div>
  );
}
