import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminPharmacistCredentialsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { PharmacistCredentialsContent } from './pharmacist-credentials-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'かかりつけ薬剤師管理 — PH-OS',
};

export default function PharmacistCredentialsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="かかりつけ薬剤師管理"
        description="研修認定・有効期限・勤務実績の管理"
        shortcuts={getAdminPharmacistCredentialsShortcutLinks()}
        supportingContent={null}
      />

      <Suspense fallback={<Loading label="かかりつけ薬剤師管理を読み込み中..." />}>
        <PharmacistCredentialsContent />
      </Suspense>
    </PageScaffold>
  );
}
