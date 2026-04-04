import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminInstitutionsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { InstitutionsContent } from './institutions-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '医療機関マスター — CareViaX',
};

export default function InstitutionsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="医療機関マスター"
        description="処方元医療機関を管理し、処方受付・疑義照会・報告書送付へ横展開します。"
        shortcuts={getAdminInstitutionsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <InstitutionsContent />
      </Suspense>
    </PageScaffold>
  );
}
