'use client';

import { useQuery } from '@tanstack/react-query';
import type { ElementType } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

type AnalyticsResponse = {
  summary: {
    ssot_rule_count: number;
    current_month: string;
    current_month_candidates: number;
    current_month_review_pending: number;
    current_month_claimable_rate: number;
    current_month_close_rate: number;
    current_month_exported: number;
  };
  monthly_trend: Array<{
    month: string;
    total_candidates: number;
    review_pending: number;
    confirmed: number;
    excluded: number;
    exported: number;
    claimable_evidence: number;
    unclaimable_evidence: number;
  }>;
  blocker_reasons: Array<{
    reason: string;
    count: number;
  }>;
  top_codes: Array<{
    billing_code: string;
    billing_name: string;
    count: number;
  }>;
};

export function AnalyticsContent() {
  const orgId = useOrgId();

  const { data, isLoading } = useQuery({
    queryKey: ['billing-analytics', orgId],
    queryFn: async () => {
      const res = await fetch('/api/billing-evidence/analytics', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('請求分析の取得に失敗しました');
      return res.json() as Promise<{ data: AnalyticsResponse }>;
    },
    enabled: !!orgId,
  });

  const analytics = data?.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={FileSpreadsheet}
          label="今月候補"
          value={analytics?.summary.current_month_candidates ?? 0}
          caption={`${analytics?.summary.current_month ?? '---- --'} の請求候補`}
          isLoading={isLoading}
        />
        <MetricCard
          icon={AlertTriangle}
          label="レビュー待ち"
          value={analytics?.summary.current_month_review_pending ?? 0}
          caption="月次締めを止めている候補"
          isLoading={isLoading}
        />
        <MetricCard
          icon={ShieldCheck}
          label="算定可率"
          value={`${analytics?.summary.current_month_claimable_rate ?? 0}%`}
          caption="当月 billing evidence ベース"
          isLoading={isLoading}
        />
        <MetricCard
          icon={CheckCircle2}
          label="締め進捗"
          value={`${analytics?.summary.current_month_close_rate ?? 0}%`}
          caption={`締め済み ${analytics?.summary.current_month_exported ?? 0} 件`}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">月次推移</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2">月</th>
                  <th className="px-2 py-2 text-right">候補</th>
                  <th className="px-2 py-2 text-right">未レビュー</th>
                  <th className="px-2 py-2 text-right">確定</th>
                  <th className="px-2 py-2 text-right">締め済み</th>
                  <th className="px-2 py-2 text-right">算定可</th>
                  <th className="px-2 py-2 text-right">算定不可</th>
                </tr>
              </thead>
              <tbody>
                {(analytics?.monthly_trend ?? []).map((row) => (
                  <tr key={row.month} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-2 font-medium">{row.month}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.total_candidates}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.review_pending}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.confirmed}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.exported}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.claimable_evidence}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.unclaimable_evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">締め阻害要因</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(analytics?.blocker_reasons.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">算定不可の主因はありません。</p>
              ) : (
                analytics?.blocker_reasons.map((item) => (
                  <div key={item.reason} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                    <span>{item.reason}</span>
                    <span className="tabular-nums text-muted-foreground">{item.count}件</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">主要算定コード</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(analytics?.top_codes.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">算定コードの実績はありません。</p>
              ) : (
                analytics?.top_codes.map((item) => (
                  <div key={`${item.billing_code}-${item.billing_name}`} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{item.billing_name}</p>
                      <p className="text-xs text-muted-foreground">{item.billing_code}</p>
                    </div>
                    <span className="tabular-nums text-muted-foreground">{item.count}件</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  caption,
  isLoading,
}: {
  icon: ElementType;
  label: string;
  value: string | number;
  caption: string;
  isLoading: boolean;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <p className="text-3xl font-bold tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
