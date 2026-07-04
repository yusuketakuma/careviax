'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Link2, Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  createPatientMcsQueryKey,
  fetchPatientMcsOverview,
  PatientMcsOverviewQueryError,
} from '@/lib/patient-mcs/query';
import { PatientMcsSummaryCard } from './patient-mcs-summary-card';

function PatientMcsSummaryLoadingState({ compact }: { compact: boolean }) {
  return (
    <div className="space-y-3" role="status" aria-label="MCS要約を読み込み中">
      <Skeleton className="h-20 w-full rounded-lg" />
      <div className={compact ? 'grid gap-3' : 'grid gap-3 xl:grid-cols-3'}>
        {Array.from({ length: compact ? 2 : 3 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <span className="sr-only">MCS要約を読み込んでいます。</span>
    </div>
  );
}

export function PatientMcsSummarySection({
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
  const shell = (body: ReactNode) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-sky-600" aria-hidden="true" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );

  const { data, isLoading, error } = useQuery({
    queryKey: createPatientMcsQueryKey(patientId, orgId, 0),
    queryFn: async () => {
      try {
        return await fetchPatientMcsOverview(patientId, orgId, 0);
      } catch (error) {
        if (error instanceof PatientMcsOverviewQueryError && error.code === 'forbidden') {
          return null;
        }
        throw error;
      }
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) return shell(<PatientMcsSummaryLoadingState compact={compact} />);
  if (error) {
    return shell(
      <div className="flex items-start gap-2 rounded-lg border border-state-confirm/30 bg-state-confirm/10 p-3 text-sm text-state-confirm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>MCS 要約を取得できませんでした。患者詳細の MCS 連携画面で再同期してください。</p>
      </div>,
    );
  }
  if (data === null) {
    return shell(
      <p className="text-sm text-muted-foreground">
        このロールでは MCS 要点を表示しません。必要時は権限のある担当者から確認してください。
      </p>,
    );
  }
  if (!data) {
    return null;
  }
  if (!data || !data.summary) {
    return shell(
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          MCS の要点サマリーはまだありません。患者詳細の MCS
          連携ページで同期するとここに表示されます。
        </p>
        <Link
          href={buildPatientHref(patientId, '/mcs')}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <Link2 className="mr-1.5 size-4" aria-hidden="true" />
          MCS 連携ページ
        </Link>
      </div>,
    );
  }

  return (
    <div className="space-y-2">
      {data.link?.lastSyncError ? (
        <div className="flex items-start gap-2 rounded-lg border border-state-confirm/30 bg-state-confirm/10 p-3 text-sm text-state-confirm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>同期エラー中のため、以下は前回成功時点の MCS 要約です。</p>
        </div>
      ) : null}
      <PatientMcsSummaryCard
        summary={data.summary}
        title={title}
        description={description}
        compact={compact}
      />
    </div>
  );
}
