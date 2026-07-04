import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminFacilityStandardsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { FacilityStandardsContent } from './facility-standards-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '施設基準管理 — PH-OS',
};

export default function FacilityStandardsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="施設基準管理"
        description="届出一覧・要件充足チェック・更新期限アラート"
        shortcuts={getAdminFacilityStandardsShortcutLinks()}
      />

      <Suspense fallback={<Loading label="施設基準管理を読み込み中..." />}>
        <FacilityStandardsContent />
      </Suspense>
    </PageScaffold>
  );
}
