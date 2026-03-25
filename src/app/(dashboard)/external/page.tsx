import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { ExternalViewerContent } from './external-viewer-content';

export const metadata: Metadata = {
  title: '外部連携ビュー — CareViaX',
};

export default function ExternalViewerPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          外部連携ビュー
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          外部連携者（ケアマネジャー・医師等）向けの閲覧専用ビュー
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <ExternalViewerContent />
      </Suspense>
    </div>
  );
}
