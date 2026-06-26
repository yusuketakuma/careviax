import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { PcaPumpsContent } from './pca-pumps-content';

export const metadata: Metadata = {
  title: 'PCAポンプレンタル — PH-OS',
};

export default function PcaPumpsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="PCAポンプレンタル"
        description="薬局から医療機関へ貸し出すPCAポンプの台帳、貸出先、返却予定、返却状況を管理します。"
        supportingContent={null}
      />

      <Suspense fallback={<Loading />}>
        <PcaPumpsContent />
      </Suspense>
    </PageScaffold>
  );
}
