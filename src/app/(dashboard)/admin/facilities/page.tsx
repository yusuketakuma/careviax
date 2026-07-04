import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminFacilitiesShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { FacilitiesContent } from './facilities-content';

export const metadata: Metadata = {
  title: '施設マスター — PH-OS',
};

export default function FacilitiesPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="施設マスター"
        description="患者居宅、訪問条件、施設担当者を管理し、訪問計画と連携先連絡に反映します。"
        shortcuts={getAdminFacilitiesShortcutLinks()}
        supportingContent={null}
      />

      <Suspense fallback={<Loading label="施設マスターを読み込み中..." />}>
        <FacilitiesContent />
      </Suspense>
    </PageScaffold>
  );
}
