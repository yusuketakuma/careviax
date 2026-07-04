import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminAuditLogsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { AuditLogsContent } from './audit-logs-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '監査ログ — PH-OS',
};

export default function AuditLogsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="監査ログ"
        description="操作履歴の閲覧・フィルタリング・CSV出力（3省2ガイドライン対応）"
        shortcuts={getAdminAuditLogsShortcutLinks()}
        supportingContent={null}
      />

      <Suspense fallback={<Loading label="監査ログを読み込み中..." />}>
        <AuditLogsContent />
      </Suspense>
    </PageScaffold>
  );
}
