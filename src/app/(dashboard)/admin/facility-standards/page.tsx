import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { FacilityStandardsContent } from './facility-standards-content';

export const metadata: Metadata = {
  title: '施設基準管理 — CareViaX',
};

export default function FacilityStandardsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          施設基準管理
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          届出一覧・要件充足チェック・更新期限アラート
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <FacilityStandardsContent />
      </Suspense>
    </div>
  );
}
