import { Metadata } from 'next';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminUatShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { UatContent } from './uat-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'パイロット UAT — PH-OS',
};

export default function UatPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="パイロット UAT チェックリスト"
        description="Phase 1b パイロット運用の受入テスト項目とフィードバック収集"
        shortcuts={getAdminUatShortcutLinks()}
      />

      <UatContent />
    </PageScaffold>
  );
}
