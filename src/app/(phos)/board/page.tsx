import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { BoardClient } from '@/phos/ui/board/BoardClient';

const PHOS_PROXY_API_BASE_URL = '/api/phos';

type PhosBoardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readInitialSelectedCardId(params: Record<string, string | string[] | undefined>) {
  return typeof params.card === 'string' && params.card.trim() ? params.card.trim() : undefined;
}

export default async function PhosBoardPage({ searchParams }: PhosBoardPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialSelectedCardId = readInitialSelectedCardId(resolvedSearchParams);

  return (
    <PageScaffold variant="bare">
      <WorkflowPageHeader
        eyebrow="PH-OS Board"
        title="PH-OS"
        description="本日の対応カードを確認し、薬剤師判断、事務対応、報告返信、算定不足を同じ起点から処理します。"
      />
      <BoardClient
        apiBaseUrl={PHOS_PROXY_API_BASE_URL}
        initialSelectedCardId={initialSelectedCardId}
      />
    </PageScaffold>
  );
}
