'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { buildOrgHeaders } from '@/lib/api/org-headers';

type RejectBreakdownItem = {
  code: string;
  label: string;
  count: number;
  percentage: number;
};

type RejectReasonStats = {
  total_rejected: number;
  period_days: number;
  breakdown: RejectBreakdownItem[];
};

const PERIOD_OPTIONS = [
  { label: '7日', days: 7 },
  { label: '30日', days: 30 },
  { label: '90日', days: 90 },
];

// 差戻し理由コード別内訳の系列色。状態色ではなくデータ可視化なので --chart-* トークンを使う。
const CODE_COLORS: Record<string, string> = {
  drug_name_mismatch: 'bg-chart-4',
  quantity_error: 'bg-chart-3',
  packaging_error: 'bg-chart-3',
  carry_type_error: 'bg-chart-3',
  labeling_error: 'bg-chart-1',
  other: 'bg-chart-5',
};

function DispenseAuditStatsLoadingState() {
  return (
    <div className="space-y-4" role="status" aria-label="調剤鑑査差戻し分析を読み込み中">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">概要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-3 w-28" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">理由コード別内訳</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-4 w-36 max-w-full" />
                </div>
                <Skeleton className="h-4 w-20 shrink-0" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DispenseAuditStatsPage() {
  const orgId = useOrgId();
  const [days, setDays] = useState(30);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['reject-reason-stats', orgId, days],
    queryFn: async () => {
      const res = await fetch(`/api/admin/reject-reason-stats?days=${days}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('統計の取得に失敗しました');
      return res.json() as Promise<{ data: RejectReasonStats }>;
    },
    enabled: !!orgId,
  });

  const stats = data?.data;

  return (
    <PageScaffold>
      <AdminPageHeader
        title="調剤鑑査差戻し分析"
        description="差戻し理由コード別の集計と傾向"
        supportingContent={null}
      />

      <div className="mb-4 flex items-center gap-2">
        {PERIOD_OPTIONS.map((opt) => (
          <Button
            key={opt.days}
            type="button"
            variant={days === opt.days ? 'default' : 'outline'}
            className="!h-11 !min-h-[44px]"
            onClick={() => setDays(opt.days)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <DispenseAuditStatsLoadingState />
      ) : isError ? (
        // 取得失敗時は空状態（false-empty）にせず、再読み込み導線つきの ErrorState を出す。
        <ErrorState
          variant="server"
          size="inline"
          onRetry={() => void refetch()}
          retryLabel="再読み込み"
        />
      ) : !stats ? (
        <p className="text-sm text-muted-foreground">データがありません</p>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">概要（直近{stats.period_days}日）</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{stats.total_rejected}</p>
              <p className="text-xs text-muted-foreground mt-0.5">件の差戻し</p>
            </CardContent>
          </Card>

          {stats.breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">差戻しはありません</p>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">理由コード別内訳</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {stats.breakdown.map((item) => (
                  <div key={item.code} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono">
                          {item.code}
                        </Badge>
                        <span>{item.label}</span>
                      </div>
                      <span className="tabular-nums font-medium">
                        {item.count}件 ({item.percentage}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${CODE_COLORS[item.code] ?? 'bg-primary'}`}
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PageScaffold>
  );
}
