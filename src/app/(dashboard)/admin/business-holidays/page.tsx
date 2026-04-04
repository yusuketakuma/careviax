import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminBusinessHolidaysShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { BusinessHolidaysContent } from './business-holidays-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '休日カレンダー — CareViaX',
};

export default function BusinessHolidaysPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="休日カレンダー"
        description="薬局の休業日・祝日・イベント日を管理します。"
        shortcuts={getAdminBusinessHolidaysShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <BusinessHolidaysContent />
      </Suspense>
    </PageScaffold>
  );
}
