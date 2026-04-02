import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminPharmacistCredentialsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { PharmacistCredentialsContent } from './pharmacist-credentials-content';

export const metadata: Metadata = {
  title: 'かかりつけ薬剤師管理 — CareViaX',
};

export default function PharmacistCredentialsPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="かかりつけ薬剤師管理"
        description="研修認定・有効期限・勤務実績の管理"
        shortcuts={getAdminPharmacistCredentialsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <PharmacistCredentialsContent />
      </Suspense>
    </div>
  );
}
