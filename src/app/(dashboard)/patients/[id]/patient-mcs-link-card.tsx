'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  canOpenPatientMcsPage,
  describePatientMcsCardStatus,
  restrictedPatientMcsCardViewData,
  type PatientMcsCardViewData,
} from '@/lib/patient-mcs/card';
import {
  createPatientMcsQueryKey,
  fetchPatientMcsOverview,
  PatientMcsOverviewQueryError,
} from '@/lib/patient-mcs/query';
import { PatientMcsSummaryCard } from '@/components/patient-mcs/patient-mcs-summary-card';

export function PatientMcsLinkCard({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const statusQuery = useQuery<PatientMcsCardViewData>({
    queryKey: createPatientMcsQueryKey(patientId, orgId, 0),
    enabled: Boolean(orgId),
    queryFn: async () => {
      try {
        const payload = await fetchPatientMcsOverview(patientId, orgId, 0);
        return {
          link: payload.link,
          summary: payload.summary,
          isRestricted: false,
        };
      } catch (error) {
        if (error instanceof PatientMcsOverviewQueryError && error.code === 'forbidden') {
          return restrictedPatientMcsCardViewData();
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('MCS 状態の取得に失敗しました');
      }
    },
  });

  const link = statusQuery.data?.link ?? null;
  const summary = statusQuery.data?.summary ?? null;
  const isRestricted = statusQuery.data?.isRestricted ?? false;
  const status = describePatientMcsCardStatus({
    link,
    isRestricted,
    isError: statusQuery.isError,
  });

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">MCS 連携</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={status.variant}>{status.label}</Badge>
          {link?.lastSyncAttemptAt ? (
            <span className="text-muted-foreground">
              最終試行 {format(new Date(link.lastSyncAttemptAt), 'M/d HH:mm', { locale: ja })}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {isRestricted
            ? 'このロールでは MCS 本文は表示しません。必要時は権限のある担当者から参照してください。'
            : status.description}
        </p>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
          <p className="font-medium text-foreground">
            患者別タイムラインを保存済みデータとして利用
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            看護師やケアマネの投稿を患者詳細から見返せるようにし、システム内の判断材料として残します。
          </p>
        </div>
        {!isRestricted && summary ? (
          <div className="space-y-2">
            {link?.lastSyncError ? (
              <p className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-xs text-state-confirm">
                同期エラー中のため、以下は前回成功時点の MCS 要約です。
              </p>
            ) : null}
            <PatientMcsSummaryCard
              summary={summary}
              title="MCS共有要点"
              description="他職種共有の要点と次アクションを患者詳細から確認できます。"
              compact
            />
          </div>
        ) : null}
        {link?.lastSyncError ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {link.lastSyncError}
          </p>
        ) : null}
        {canOpenPatientMcsPage(statusQuery.data) ? (
          <Link
            href={buildPatientHref(patientId, '/mcs')}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Link2 className="mr-1.5 size-4" aria-hidden="true" />
            MCS 連携ページを開く
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
