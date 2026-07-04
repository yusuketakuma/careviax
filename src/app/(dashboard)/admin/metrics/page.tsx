import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminMetricsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { MetricsDashboardContent } from './metrics-dashboard-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '経営指標 — PH-OS',
};

export default function MetricsDashboardPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="経営指標ダッシュボード"
        description="薬局経営に関わる主要指標のモニタリング"
        shortcuts={getAdminMetricsShortcutLinks()}
      />

      <Suspense fallback={<Loading label="経営指標ダッシュボードを読み込み中..." />}>
        <MetricsDashboardContent />
      </Suspense>
    </PageScaffold>
  );
}
