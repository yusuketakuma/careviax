'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info, FileX, XCircle } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

type BillingStats = {
  not_claimable: number;
  evidence_insufficient: number;
  delivery_incomplete: number;
};

export function BillingDashboardContent() {
  const orgId = useOrgId();

  const { data, isLoading } = useQuery({
    queryKey: ['billing-stats', orgId],
    queryFn: async () => {
      const res = await fetch('/api/billing-evidence/stats', {
        headers: { 'x-org-id': orgId },
      });
      // Gracefully handle 404 since this API is Phase 2
      if (res.status === 404) {
        return { data: { not_claimable: 0, evidence_insufficient: 0, delivery_incomplete: 0 } } as { data: BillingStats };
      }
      if (!res.ok) throw new Error('請求統計の取得に失敗しました');
      return res.json() as Promise<{ data: BillingStats }>;
    },
    enabled: !!orgId,
  });

  const stats = data?.data;

  return (
    <div className="space-y-6">
      {/* Phase 2 notice */}
      <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">Phase 2 実装予定</p>
          <p className="mt-0.5 text-blue-700">
            詳細な算定ルールエンジン・請求候補自動抽出・レセコン連携は
            Phase 2 で実装します。現在は件数サマリーのみ表示します。
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <XCircleIcon />
              算定不可
            </CardTitle>
            <CardDescription className="text-xs">
              根拠不備等で算定できない訪問件数
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (stats?.not_claimable ?? 0) > 0 ? 'text-destructive' : ''
                }`}
              >
                {stats?.not_claimable ?? 0}
              </span>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertTriangle className="size-4" aria-hidden="true" />
              根拠不足
            </CardTitle>
            <CardDescription className="text-xs">
              同意書・計画書・報告書が不足している件数
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (stats?.evidence_insufficient ?? 0) > 0
                    ? 'text-orange-600'
                    : ''
                }`}
              >
                {stats?.evidence_insufficient ?? 0}
              </span>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileX className="size-4" aria-hidden="true" />
              送付未完了
            </CardTitle>
            <CardDescription className="text-xs">
              報告書の送付が完了していない件数
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (stats?.delivery_incomplete ?? 0) > 0
                    ? 'text-orange-600'
                    : ''
                }`}
              >
                {stats?.delivery_incomplete ?? 0}
              </span>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function XCircleIcon() {
  return <XCircle className="size-4" aria-hidden="true" />;
}
