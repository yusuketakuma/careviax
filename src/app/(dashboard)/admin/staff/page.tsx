import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminStaffShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { UsersContent } from '@/app/(dashboard)/admin/users/users-content';
import { StaffBulkActions } from './staff-bulk-actions';
import { StaffKpiPanel } from './staff-kpi-panel';

export const metadata: Metadata = {
  title: 'スタッフ運用管理 — CareViaX',
};

export default function StaffPage() {
  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title="スタッフ運用管理"
        description="採用、配置、勤怠負荷、一括取込を 1 画面で扱います。"
        shortcuts={getAdminStaffShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <StaffKpiPanel />
      </Suspense>

      <Suspense fallback={<Loading />}>
        <StaffBulkActions />
      </Suspense>

      <Suspense fallback={<Loading />}>
        <UsersContent />
      </Suspense>
    </div>
  );
}
