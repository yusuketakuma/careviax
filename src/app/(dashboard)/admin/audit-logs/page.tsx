import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminAuditLogsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { AuditLogsContent } from './audit-logs-content';

export const metadata: Metadata = {
  title: '監査ログ — CareViaX',
};

export default function AuditLogsPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="監査ログ"
        description="操作履歴の閲覧・フィルタリング・CSV出力（3省2ガイドライン対応）"
        shortcuts={getAdminAuditLogsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <AuditLogsContent />
      </Suspense>
    </div>
  );
}
