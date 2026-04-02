import { Metadata } from 'next';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminUatShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { UatContent } from './uat-content';

export const metadata: Metadata = {
  title: 'パイロット UAT — CareViaX',
};

export default function UatPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="パイロット UAT チェックリスト"
        description="Phase 1b パイロット運用の受入テスト項目とフィードバック収集"
        shortcuts={getAdminUatShortcutLinks()}
      />

      <UatContent />
    </div>
  );
}
