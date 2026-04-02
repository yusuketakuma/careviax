import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminUsersShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { UsersContent } from './users-content';

export const metadata: Metadata = {
  title: 'ユーザー管理 — CareViaX',
};

export default function UsersPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="ユーザー管理"
        description="スタッフの招待・権限変更・停止を管理します。"
        shortcuts={getAdminUsersShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <UsersContent />
      </Suspense>
    </div>
  );
}
