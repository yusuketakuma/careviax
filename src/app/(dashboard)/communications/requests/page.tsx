import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { CommunicationRequestsContent } from './requests-content';

export const metadata: Metadata = {
  title: '依頼・照会一覧 — CareViaX',
};

export default function CommunicationRequestsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          依頼・照会一覧
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          返信待ち・対応中・完了の依頼・照会を管理します
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <CommunicationRequestsContent />
      </Suspense>
    </div>
  );
}
