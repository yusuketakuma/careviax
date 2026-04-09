'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { PatientReadinessSnapshot } from './patient-detail.types';

export function PatientReadinessCard({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const readinessQuery = useQuery<PatientReadinessSnapshot>({
    queryKey: ['patient-readiness', patientId, orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/readiness`, {
        headers: { 'x-org-id': orgId ?? '' },
      });
      if (!response.ok) {
        throw new Error('オンボーディング状況の取得に失敗しました');
      }
      return response.json();
    },
  });

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">訪問開始 readiness</CardTitle>
        </CardHeader>
        <CardContent>
          <Loading label="訪問開始 readiness を読み込み中..." />
        </CardContent>
      </Card>
    );
  }

  if (readinessQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">訪問開始 readiness</CardTitle>
        </CardHeader>
        <CardContent>
          <Loading label="訪問開始 readiness を読み込み中..." />
        </CardContent>
      </Card>
    );
  }

  if (readinessQuery.error instanceof Error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">訪問開始 readiness</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{readinessQuery.error.message}</p>
        </CardContent>
      </Card>
    );
  }

  const readiness = readinessQuery.data;
  if (!readiness || !readiness.applicable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">訪問開始 readiness</CardTitle>
          <CardDescription>初回訪問前の前提条件を確認します。</CardDescription>
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
            <CardTitle className="text-base">訪問開始 readiness</CardTitle>
            <CardDescription className="mt-1">
              初回訪問に必要な前提条件を患者詳細から確認できます。
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
                ? 'border-emerald-200 bg-emerald-50/60'
                : item.severity === 'high'
                  ? 'border-amber-200 bg-amber-50/70'
                  : 'border-border/70 bg-muted/10'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {item.completed ? (
                    <CheckCircle2 className="size-4 text-emerald-700" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="size-4 text-amber-700" aria-hidden="true" />
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
