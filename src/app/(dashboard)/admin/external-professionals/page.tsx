import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { ExternalProfessionalsContent } from './external-professionals-content';

export const metadata: Metadata = {
  title: '他職種マスター — CareViaX',
};

export default function ExternalProfessionalsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">他職種マスター</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          医師・看護師・ケアマネジャー等の連携先を管理します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <ExternalProfessionalsContent />
      </Suspense>
    </div>
  );
}
