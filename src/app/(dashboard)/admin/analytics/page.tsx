import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminAnalyticsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { AnalyticsContent } from './analytics-content';

export const metadata: Metadata = {
  title: 'KPI分析 — CareViaX',
};

export default function AnalyticsPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="KPI分析ダッシュボード"
        description="請求 SSOT と運用実績を月次で分析します。"
        shortcuts={getAdminAnalyticsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <AnalyticsContent />
      </Suspense>
    </div>
  );
}
