import { IncidentsContent } from './incidents-content';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata = {
  title: 'ヒヤリハット管理 — PH-OS',
};

export default function IncidentsPage() {
  return (
    <PageScaffold variant="bare">
      {/* SYS-3: sr-only h1 + 素の div を共通 PageScaffold + AdminPageHeader へ統一。 */}
      <AdminPageHeader
        title="ヒヤリハット管理"
        description="インシデント記録と再発防止メモを確認し、対応状況を追跡します。"
      />
      <IncidentsContent />
    </PageScaffold>
  );
}
