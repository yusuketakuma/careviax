import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { ContactProfilesContent } from './contact-profiles-content';

export const metadata: Metadata = {
  title: '連携先プロファイル — CareViaX',
};

export default function ContactProfilesPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">連携先プロファイル</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          施設担当者・他職種・処方元医療機関の連絡傾向を横断確認します。
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <ContactProfilesContent />
      </Suspense>
    </div>
  );
}
