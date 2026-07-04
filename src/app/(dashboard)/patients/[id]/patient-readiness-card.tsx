'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import type { PatientReadinessSnapshot } from './patient-detail.types';

function ReadinessHeading() {
  return (
    <h2 className="font-heading text-base leading-snug font-medium">
      患者情報・訪問開始 readiness
    </h2>
  );
}

function PatientReadinessLoadingCard() {
  return (
    <Card>
      <CardHeader>
        <ReadinessHeading />
      </CardHeader>
      <CardContent
        className="space-y-3"
        role="status"
        aria-label="患者情報・訪問開始 readiness を読み込み中"
      >
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border/70 bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
        ))}
        <span className="sr-only">患者情報・訪問開始 readiness を読み込んでいます。</span>
      </CardContent>
    </Card>
  );
}

export function PatientReadinessCard({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const readinessQuery = useQuery<PatientReadinessSnapshot>({
    queryKey: ['patient-readiness', patientId, orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId, '/readiness'), {
        headers: buildOrgHeaders(orgId ?? ''),
      });
      if (!response.ok) {
        throw new Error('オンボーディング状況の取得に失敗しました');
      }
      return response.json();
    },
  });

  if (!orgId) {
    return <PatientReadinessLoadingCard />;
  }

  if (readinessQuery.isLoading) {
    return <PatientReadinessLoadingCard />;
  }

  if (readinessQuery.error instanceof Error) {
    return (
      <Card>
        <CardHeader>
          <ReadinessHeading />
        </CardHeader>
        <CardContent>
          <p role="status" aria-live="polite" className="text-sm text-destructive">
            {readinessQuery.error.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  const readiness = readinessQuery.data;
  if (!readiness || !readiness.applicable) {
    return (
      <Card>
        <CardHeader>
          <ReadinessHeading />
          <CardDescription>患者情報と初回訪問前の前提条件を確認します。</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={ClipboardCheck}
            title="対象ケースがありません"
            description="紹介受領、アセスメント、稼働中のケースが作成されると readiness を表示します。"
          />
        </CardContent>
      </Card>
    );
  }

  const remainingCount = readiness.total_count - readiness.completed_count;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <ReadinessHeading />
            <CardDescription className="mt-1">
              訪問時、報告書、他職種連携に必要な患者情報と前提条件を確認できます。
            </CardDescription>
          </div>
          <Badge variant={readiness.overall_status === 'ready' ? 'default' : 'secondary'}>
            {readiness.completed_count}/{readiness.total_count}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">完了 {readiness.completed_count}</Badge>
          <Badge variant="outline">未完了 {remainingCount}</Badge>
          {readiness.current_case ? (
            <Badge variant="outline">ケース {readiness.current_case.status}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {readiness.items.map((item) => (
          <div
            key={item.key}
            className={`rounded-xl border p-3 ${
              item.completed
                ? 'border-l-4 border-border/70 border-l-state-done bg-card'
                : item.severity === 'high'
                  ? 'border-l-4 border-border/70 border-l-state-confirm bg-card'
                  : 'border-border/70 bg-muted/10'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {item.completed ? (
                    <CheckCircle2 className="size-4 text-state-done" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
                  )}
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
              <Button asChild size="sm" variant={item.completed ? 'outline' : 'default'}>
                <Link href={item.action_href}>{item.action_label}</Link>
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
