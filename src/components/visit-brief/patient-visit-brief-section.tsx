'use client';

import { useQuery } from '@tanstack/react-query';
import { VisitBriefCard } from '@/components/visit-brief/visit-brief-card';
import { readApiJson } from '@/lib/api/client-json';
import { Skeleton } from '@/components/ui/loading';
import { SegmentError, SegmentStaleBanner } from '@/components/ui/segment-state';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useStaleAfterRefetchError } from '@/lib/hooks/use-stale-after-refetch-error';
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
    isRefetchError,
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
  const visitBriefState = useStaleAfterRefetchError({
    data,
    isLoading,
    isError,
    isRefetchError,
  });

  if (!orgId || visitBriefState.isInitialLoading) {
    return <PatientVisitBriefLoadingState compact={compact} />;
  }
  if (visitBriefState.isInitialError) {
    return (
      <SegmentError
        headingLevel={3}
        title="訪問前要約を読み込めませんでした"
        cause="患者の訪問前要約を取得できませんでした。"
        nextAction="通信状態を確認して再試行してください。"
        onRetry={() => void refetchVisitBrief()}
        className="[&_[data-slot=button]]:min-h-11 sm:[&_[data-slot=button]]:min-h-11"
      />
    );
  }
  if (!data?.data) {
    return (
      <SegmentError
        headingLevel={3}
        title="訪問前要約の内容を確認できませんでした"
        cause="要約APIの応答に必要な患者データがありません。"
        nextAction="再読み込みしてください。"
        onRetry={() => void refetchVisitBrief()}
        className="[&_[data-slot=button]]:min-h-11 sm:[&_[data-slot=button]]:min-h-11"
      />
    );
  }

  return (
    <div className="space-y-3">
      {visitBriefState.isStaleAfterRefetchError ? (
        <SegmentStaleBanner
          title="前回取得した訪問前要約を表示中"
          description="最新の患者・処方・多職種情報を取得できませんでした。表示内容が古い可能性があります。"
          onRetry={() => void refetchVisitBrief()}
          className="[&_[data-slot=button]]:min-h-11 sm:[&_[data-slot=button]]:min-h-11"
        />
      ) : null}
      <VisitBriefCard brief={data.data} title={title} description={description} compact={compact} />
    </div>
  );
}
