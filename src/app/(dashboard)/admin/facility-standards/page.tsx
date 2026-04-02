import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminFacilityStandardsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { FacilityStandardsContent } from './facility-standards-content';

export const metadata: Metadata = {
  title: '施設基準管理 — CareViaX',
};

export default function FacilityStandardsPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="施設基準管理"
        description="届出一覧・要件充足チェック・更新期限アラート"
        shortcuts={getAdminFacilityStandardsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <FacilityStandardsContent />
      </Suspense>
    </div>
  );
}
