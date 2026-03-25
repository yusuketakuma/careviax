import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { SettingsContent } from './settings-content';

export const metadata: Metadata = {
  title: '管理設定 — CareViaX',
};

export default function SettingsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          管理設定
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          システム・法人・店舗・個人の4層設定
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}
