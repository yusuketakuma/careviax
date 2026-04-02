import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminContactProfilesShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { ContactProfilesContent } from './contact-profiles-content';

export const metadata: Metadata = {
  title: '連携先プロファイル — CareViaX',
};

export default function ContactProfilesPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="連携先プロファイル"
        description="施設担当者・他職種・処方元医療機関の連絡傾向を横断確認します。"
        shortcuts={getAdminContactProfilesShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <ContactProfilesContent />
      </Suspense>
    </div>
  );
}
