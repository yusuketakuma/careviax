import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminOperatingHoursShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { OperatingHoursContent } from './operating-hours-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '稼働日設定 — PH-OS',
};

export default function OperatingHoursPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="稼働日設定"
        description="薬局の週次営業時間と稼働日を管理します。休業日は休日カレンダーと連動します。"
        shortcuts={getAdminOperatingHoursShortcutLinks()}
        supportingContent={null}
      />

      <Suspense fallback={<Loading />}>
        <OperatingHoursContent />
      </Suspense>
    </PageScaffold>
  );
}
