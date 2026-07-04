import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminStaffShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { UsersContent } from '../users/users-content';
import { StaffKpiPanel } from './staff-kpi-panel';

export const metadata: Metadata = {
  title: 'スタッフ管理 — PH-OS',
};

export default function StaffPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="スタッフ管理"
        description="スタッフの稼働KPI、招待、権限、停止状態を管理します。"
        shortcuts={getAdminStaffShortcutLinks()}
        supportingContent={null}
      />

      <Suspense fallback={<Loading label="スタッフ管理を読み込み中..." />}>
        <div className="space-y-4">
          <StaffKpiPanel />
          <UsersContent />
        </div>
      </Suspense>
    </PageScaffold>
  );
}
