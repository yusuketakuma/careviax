'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState, type ElementType } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, ShieldCheck, MapPinned } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

type ResourceMapResponse = {
  summary: {
    total_sites: number;
    emergency_ready_sites: number;
    holiday_gap_sites: number;
    missing_geo_sites: number;
  };
  data: Array<{
    id: string;
    name: string;
    address: string;
    phone: string | null;
    emergency_capable_shift_count: number;
    holiday_gap_dates: Array<{
      id: string;
      date: string;
      name: string;
    }>;
    supports_narcotic: boolean;
    supports_sterile: boolean;
    can_delegate: boolean;
    has_geo: boolean;
    capability_tags: string[];
    action_href: string;
  }>;
};

type ResourceFilter =
  | 'all'
  | 'emergency_ready'
  | 'holiday_gap'
  | 'narcotic'
  | 'sterile'
  | 'delegate'
  | 'missing_geo';

function inferAreaLabel(address: string) {
  const match = address.match(/^(.*?[都道府県].*?[市区町村])/);
  if (match?.[1]) return match[1];
  return address.slice(0, 12);
}

export function AnalyticsContent() {
  const orgId = useOrgId();
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');

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

  const { data: resourceMapData, isLoading: resourceMapLoading } = useQuery({
    queryKey: ['pharmacy-sites', orgId, 'resource-map'],
    queryFn: async () => {
      const res = await fetch('/api/pharmacy-sites?view=resource_map', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('地域資源マップの取得に失敗しました');
      return res.json() as Promise<{ data: ResourceMapResponse['data']; summary: ResourceMapResponse['summary'] }>;
    },
    enabled: !!orgId,
  });

  const analytics = data?.data;
  const resourceMap = resourceMapData;
  const filteredSites = useMemo(() => {
    const sites = resourceMap?.data ?? [];
    switch (resourceFilter) {
      case 'emergency_ready':
        return sites.filter((site) => site.emergency_capable_shift_count > 0);
      case 'holiday_gap':
        return sites.filter((site) => site.holiday_gap_dates.length > 0);
      case 'narcotic':
        return sites.filter((site) => site.supports_narcotic);
      case 'sterile':
        return sites.filter((site) => site.supports_sterile);
      case 'delegate':
        return sites.filter((site) => site.can_delegate);
      case 'missing_geo':
        return sites.filter((site) => !site.has_geo);
      default:
        return sites;
    }
  }, [resourceFilter, resourceMap?.data]);
  const areaSummary = useMemo(() => {
    const grouped = new Map<
      string,
      {
        area: string;
        siteCount: number;
        emergencyReady: number;
        holidayGap: number;
      }
    >();

    for (const site of resourceMap?.data ?? []) {
      const area = inferAreaLabel(site.address);
      const existing = grouped.get(area) ?? {
        area,
        siteCount: 0,
        emergencyReady: 0,
        holidayGap: 0,
      };
      existing.siteCount += 1;
      if (site.emergency_capable_shift_count > 0) existing.emergencyReady += 1;
      if (site.holiday_gap_dates.length > 0) existing.holidayGap += 1;
      grouped.set(area, existing);
    }

    return Array.from(grouped.values()).sort((left, right) => right.siteCount - left.siteCount);
  }, [resourceMap?.data]);

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

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">地域資源マップ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <MetricCard
                icon={MapPinned}
                label="拠点数"
                value={resourceMap?.summary.total_sites ?? 0}
                caption="集約対象の拠点"
                isLoading={resourceMapLoading}
              />
              <MetricCard
                icon={ShieldCheck}
                label="緊急対応可"
                value={resourceMap?.summary.emergency_ready_sites ?? 0}
                caption="直近シフトあり"
                isLoading={resourceMapLoading}
              />
              <MetricCard
                icon={AlertTriangle}
                label="休日ギャップ"
                value={resourceMap?.summary.holiday_gap_sites ?? 0}
                caption="当番未設定の拠点"
                isLoading={resourceMapLoading}
              />
              <MetricCard
                icon={AlertTriangle}
                label="座標未整備"
                value={resourceMap?.summary.missing_geo_sites ?? 0}
                caption="lat/lng 未設定"
                isLoading={resourceMapLoading}
              />
            </div>
            <Link
              href="/workflow"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              緊急時プレイブックを確認
            </Link>
            <div className="grid gap-2">
              <p className="text-xs font-medium text-muted-foreground">地域別サマリー</p>
              {areaSummary.length === 0 ? (
                <p className="text-sm text-muted-foreground">地域別集計はありません。</p>
              ) : (
                areaSummary.slice(0, 6).map((area) => (
                  <div
                    key={area.area}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{area.area}</p>
                      <p className="text-xs text-muted-foreground">
                        緊急対応 {area.emergencyReady} / 休日ギャップ {area.holidayGap}
                      </p>
                    </div>
                    <span className="tabular-nums text-muted-foreground">{area.siteCount}拠点</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">拠点別の対応体制</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {[
                ['all', '全拠点'],
                ['emergency_ready', '緊急対応可'],
                ['holiday_gap', '休日ギャップ'],
                ['narcotic', '麻薬対応'],
                ['sterile', '無菌対応'],
                ['delegate', '代行可'],
                ['missing_geo', '座標未整備'],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={resourceFilter === value ? 'default' : 'outline'}
                  onClick={() => setResourceFilter(value as ResourceFilter)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {filteredSites.length === 0 ? (
              <p className="text-sm text-muted-foreground">地域資源データはありません。</p>
            ) : (
              filteredSites.map((site) => (
                <div key={site.id} className="rounded-lg border border-border px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{site.name}</p>
                      <p className="text-xs text-muted-foreground">{site.address}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {site.capability_tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                      {!site.has_geo && <Badge variant="destructive">座標未整備</Badge>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>緊急対応シフト {site.emergency_capable_shift_count}件</span>
                    <span>麻薬 {site.supports_narcotic ? '対応可' : '未確認'}</span>
                    <span>無菌 {site.supports_sterile ? '対応可' : '未確認'}</span>
                    <span>代行 {site.can_delegate ? '可' : '要確認'}</span>
                  </div>
                  {site.holiday_gap_dates.length > 0 ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      空白日: {site.holiday_gap_dates.map((item) => `${item.date.slice(5, 10)} ${item.name}`).join(' / ')}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-emerald-700">直近の休日空白はありません。</p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
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
