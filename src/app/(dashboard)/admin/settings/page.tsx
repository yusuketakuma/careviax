import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminSettingsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { SettingsContent } from './settings-content';

export const metadata: Metadata = {
  title: '管理設定 — CareViaX',
};

export default function SettingsPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="管理設定"
        description="システム・法人・店舗・個人の4層設定"
        shortcuts={getAdminSettingsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}
