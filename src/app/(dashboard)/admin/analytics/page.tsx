import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminAnalyticsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { AnalyticsContent } from './analytics-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'KPI分析 — PH-OS',
};

export default function AnalyticsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="KPI分析ダッシュボード"
        description="請求 SSOT と運用実績を月次で分析します。"
        shortcuts={getAdminAnalyticsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <AnalyticsContent />
      </Suspense>
    </PageScaffold>
  );
}
