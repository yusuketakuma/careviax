import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { PhosVisitModePageCopy } from '@/phos/contracts/phos_copy.ja';
import { VisitModePageClient } from '@/phos/ui/visit/VisitModePageClient';

type PhosVisitPageProps = {
  params: Promise<{ packetId: string }>;
};

export default async function PhosVisitPage({ params }: PhosVisitPageProps) {
  const { packetId } = await params;

  return (
    <PageScaffold variant="bare">
      <WorkflowPageHeader
        eyebrow={PhosVisitModePageCopy.EYEBROW}
        title={PhosVisitModePageCopy.TITLE}
        description={PhosVisitModePageCopy.DESCRIPTION}
      />
      <VisitModePageClient
        packetId={packetId}
        apiBaseUrl={process.env.NEXT_PUBLIC_PHOS_API_BASE_URL}
      />
    </PageScaffold>
  );
}
