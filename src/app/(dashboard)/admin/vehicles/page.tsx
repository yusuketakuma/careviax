import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { VehiclesContent } from './vehicles-content';

export const metadata: Metadata = {
  title: '車両マスター — PH-OS',
};

/**
 * /admin/vehicles。P0-43 車両マスター(カテゴリ / 車両一覧 / 詳細を編集の 3 カラム)。
 * 一覧・編集は visit-vehicle-resources API(GET/PATCH)を利用する。
 */
export default function VehiclesPage() {
  return (
    <PageScaffold variant="bare">
      <div className="rounded-xl border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(34,113,177,0.10),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_26%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] px-6 py-5">
        <AdminPageHeader
          title="車両マスター"
          description="訪問に使う車両の名称・分類・稼働状態を管理し、配車候補とルート作成に利用します。"
        />
      </div>

      <Suspense fallback={<Loading />}>
        <VehiclesContent />
      </Suspense>
    </PageScaffold>
  );
}
