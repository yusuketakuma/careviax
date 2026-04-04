import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminPharmacySitesShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { PharmacySitesContent } from './pharmacy-sites-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '薬局情報管理 — CareViaX',
};

export default function PharmacySitesPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="薬局情報管理"
        description="薬局の基本情報・届出フラグ・保険算定設定を管理します。"
        shortcuts={getAdminPharmacySitesShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <PharmacySitesContent />
      </Suspense>
    </PageScaffold>
  );
}
