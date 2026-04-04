import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminFacilitiesShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { FacilitiesContent } from './facilities-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '施設マスター — CareViaX',
};

export default function FacilitiesPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="施設マスター"
        description="施設基本情報と連絡先を管理し、患者登録・訪問計画に利用します。"
        shortcuts={getAdminFacilitiesShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <FacilitiesContent />
      </Suspense>
    </PageScaffold>
  );
}
