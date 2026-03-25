import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { ConferencesContent } from './conferences-content';

export const metadata: Metadata = {
  title: 'カンファレンス — CareViaX',
};

export default function ConferencesPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          カンファレンスノート
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          多職種カンファレンスの記録・アクションアイテム管理
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <ConferencesContent />
      </Suspense>
    </div>
  );
}
