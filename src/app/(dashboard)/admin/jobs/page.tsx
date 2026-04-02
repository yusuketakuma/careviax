import { Suspense } from 'react';
import { type Metadata } from 'next';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminJobsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { JobsDashboardContent } from './jobs-dashboard-content';

export const metadata: Metadata = { title: 'ジョブ監視 — CareViaX' };

export default function JobsDashboardPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="ジョブ監視"
        description="IntegrationJob の実行状況・エラーログ・手動再実行"
        shortcuts={getAdminJobsShortcutLinks()}
      />
      <Suspense fallback={<Loading />}>
        <JobsDashboardContent />
      </Suspense>
    </div>
  );
}
