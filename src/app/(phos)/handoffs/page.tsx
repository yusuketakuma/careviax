import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { HandoffsPageClient } from '@/phos/ui/handoff/HandoffsPageClient';

const PHOS_PROXY_API_BASE_URL = '/api/phos';

export default function PhosHandoffsPage() {
  return (
    <PageScaffold variant="bare">
      <WorkflowPageHeader
        eyebrow="PH-OS Handoffs"
        title="Handoff Queue"
        description="事務員から薬剤師へ渡された確認依頼を、根拠と希望対応を見ながら処理します。"
      />
      <HandoffsPageClient apiBaseUrl={PHOS_PROXY_API_BASE_URL} />
    </PageScaffold>
  );
}
