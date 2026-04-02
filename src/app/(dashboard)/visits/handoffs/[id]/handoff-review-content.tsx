'use client';

import { useQuery } from '@tanstack/react-query';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getVisitHandoffShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { HandoffConfirmPanel } from '@/components/features/visits/handoff-confirm-panel';
import { ErrorState } from '@/components/ui/error-state';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { VisitHandoff } from '@/types/visit-brief';

export function HandoffReviewContent({ visitRecordId }: { visitRecordId: string }) {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['visit-handoff', orgId, visitRecordId],
    queryFn: async () => {
      const res = await fetch(`/api/visit-records/${visitRecordId}/handoff`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? '申し送りの取得に失敗しました');
      }
      return res.json() as Promise<{ data: VisitHandoff }>;
    },
    enabled: !!orgId,
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <WorkflowBackLink href="/handoff" label="申し送り一覧へ戻る" />
      </div>

      <WorkflowPageHeader
        title="申し送り確認"
        description="訪問後の申し送り内容を確認し、次の対応面へつなげます。"
        className="mb-0"
      >
        <PageShortcutLinks links={getVisitHandoffShortcutLinks(visitRecordId)} />
      </WorkflowPageHeader>

      {isBootstrappingOrg || isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState
          variant="server"
          title="申し送りを表示できません"
          description="引継ぎ確認データの取得に失敗しました。"
          detail={error instanceof Error ? error.message : undefined}
          action={{ label: '再試行', onClick: () => void refetch() }}
        />
      ) : data ? (
        <HandoffConfirmPanel visitRecordId={visitRecordId} handoff={data.data} />
      ) : (
        <ErrorState
          variant="not-found"
          title="申し送りデータが見つかりません"
          description="AI 抽出または確認対象データが未作成の可能性があります。"
          action={{ label: '申し送り一覧へ戻る', href: '/handoff' }}
        />
      )}
    </div>
  );
}
