import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminShiftsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { ShiftsContent } from './shifts-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '薬剤師シフト管理 — PH-OS',
};

export default function ShiftsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="薬剤師シフト管理"
        description="月間シフトの確認・編集"
        shortcuts={getAdminShiftsShortcutLinks()}
        supportingContent={null}
      />

      <Suspense fallback={<Loading label="薬剤師シフト管理を読み込み中..." />}>
        <ShiftsContent />
      </Suspense>
    </PageScaffold>
  );
}
