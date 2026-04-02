import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminShiftsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { ShiftsContent } from './shifts-content';

export const metadata: Metadata = {
  title: '薬剤師シフト管理 — CareViaX',
};

export default function ShiftsPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="薬剤師シフト管理"
        description="月間シフトの確認・編集"
        shortcuts={getAdminShiftsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <ShiftsContent />
      </Suspense>
    </div>
  );
}
