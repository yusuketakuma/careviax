import { type Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminPackagingMethodsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { PackagingMethodsContent } from './packaging-methods-content';

export const metadata: Metadata = {
  title: '配薬方法マスター — CareViaX',
};

export default function PackagingMethodsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="配薬方法マスター"
        description="セット計画、患者設定、訪問時の配薬確認で使う配薬方法を管理します。"
        shortcuts={getAdminPackagingMethodsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <PackagingMethodsContent />
      </Suspense>
    </PageScaffold>
  );
}
