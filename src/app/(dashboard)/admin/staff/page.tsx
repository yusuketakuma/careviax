import { Metadata } from 'next';
import { Suspense } from 'react';
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          スタッフ運用管理
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          採用、配置、勤怠負荷、一括取込を 1 画面で扱います。
        </p>
      </div>

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
