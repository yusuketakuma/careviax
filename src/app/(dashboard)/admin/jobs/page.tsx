import { Suspense } from 'react';
import { type Metadata } from 'next';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminJobsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { JobsDashboardContent } from './jobs-dashboard-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = { title: 'ジョブ監視 — PH-OS' };

export default function JobsDashboardPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="ジョブ監視"
        description="IntegrationJob の実行状況・エラーログ・手動再実行"
        shortcuts={getAdminJobsShortcutLinks()}
        supportingContent={null}
      />
      <Suspense fallback={<Loading />}>
        <JobsDashboardContent />
      </Suspense>
    </PageScaffold>
  );
}
