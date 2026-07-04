import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminExternalProfessionalsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { ExternalProfessionalsContent } from './external-professionals-content';

export const metadata: Metadata = {
  title: '他職種マスター — PH-OS',
};

export default function ExternalProfessionalsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="他職種マスター"
        description="患者ケアチーム、報告書送付、連絡先プロファイルで再利用する他職種の正本を管理します。"
        shortcuts={getAdminExternalProfessionalsShortcutLinks()}
        supportingContent={null}
      />

      <Suspense fallback={<Loading label="他職種マスターを読み込み中..." />}>
        <ExternalProfessionalsContent />
      </Suspense>
    </PageScaffold>
  );
}
