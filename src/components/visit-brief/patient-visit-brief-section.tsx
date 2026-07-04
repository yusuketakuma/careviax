'use client';

import { useQuery } from '@tanstack/react-query';
import { VisitBriefCard } from '@/components/visit-brief/visit-brief-card';
import { readApiJson } from '@/lib/api/client-json';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import type { VisitBrief } from '@/types/visit-brief';

function PatientVisitBriefLoadingState({ compact }: { compact: boolean }) {
  return (
    <section
      className={compact ? 'space-y-2' : 'space-y-3 rounded-lg border bg-card p-4'}
      role="status"
      aria-label="訪問前要約を読み込み中"
    >
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-3 w-56 max-w-full" />
      <div className="space-y-2 pt-1">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <span className="sr-only">訪問前要約を読み込んでいます。</span>
    </section>
  );
}

export function PatientVisitBriefSection({
  patientId,
  title,
  description,
  compact = false,
}: {
  patientId: string;
  title: string;
  description: string;
  compact?: boolean;
}) {
  const orgId = useOrgId();

  const {
    data,
    isLoading,
    isError,
    refetch: refetchVisitBrief,
  } = useQuery({
    queryKey: ['patient-visit-brief', patientId, orgId],
    queryFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId, '/visit-brief'), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: VisitBrief }>(response, '患者要約の取得に失敗しました');
    },
    enabled: !!orgId,
  });

  if (isLoading) return <PatientVisitBriefLoadingState compact={compact} />;
  if (isError) {
    return (
      <ErrorState
        variant="server"
        size="inline"
        headingLevel={3}
        title="訪問前要約を読み込めませんでした"
        description="患者の訪問前要約を取得できませんでした。通信状態を確認して再試行してください。"
        onRetry={() => void refetchVisitBrief()}
      />
    );
  }
  if (!data?.data) return null;

  return (
    <VisitBriefCard brief={data.data} title={title} description={description} compact={compact} />
  );
}
