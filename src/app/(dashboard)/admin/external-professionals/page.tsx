import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminExternalProfessionalsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { CollaborationWorkflowPanel } from '@/components/features/workflow/collaboration-workflow-panel';
import { Loading } from '@/components/ui/loading';
import { ExternalProfessionalsContent } from './external-professionals-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '他職種マスター — CareViaX',
};

export default function ExternalProfessionalsPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="他職種マスター"
        description="医師・看護師・ケアマネジャー等の連携先を管理します。"
        shortcuts={getAdminExternalProfessionalsShortcutLinks()}
      />
      <CollaborationWorkflowPanel
        focus="master"
        description="連携先マスターを整えることで、疑義照会、外部共有、報告書送付の宛先候補を安定させます。"
      />

      <Suspense fallback={<Loading />}>
        <ExternalProfessionalsContent />
      </Suspense>
    </PageScaffold>
  );
}
