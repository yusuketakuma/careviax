import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminVehiclesShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { VehiclesContent } from './vehicles-content';

export const metadata: Metadata = {
  title: '車両マスター — PH-OS',
};

export default function VehiclesPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="車両マスター"
        description="訪問ルート、共有車両キャパシティ、スケジュール提案で使う車両リソースの正本を管理します。"
        shortcuts={getAdminVehiclesShortcutLinks()}
        supportingContent={null}
      />

      <Suspense fallback={<Loading label="車両マスターを読み込み中..." />}>
        <VehiclesContent />
      </Suspense>
    </PageScaffold>
  );
}
