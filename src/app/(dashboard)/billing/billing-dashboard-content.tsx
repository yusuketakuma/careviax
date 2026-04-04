'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Info, FileX } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { SectionIntro } from '@/components/ui/section-intro';

type BillingStats = {
  not_claimable: number;
  evidence_insufficient: number;
  delivery_incomplete: number;
  ssot_rule_count: number;
  confirmed_candidates: number;
  review_required_candidates: number;
  exported_candidates: number;
  current_month_candidates: number;
  current_month_claimable_evidence: number;
  current_month_unclaimable_evidence: number;
  current_month_close_ready: number;
  current_month_close_blocked: number;
  open_billing_review_tasks: number;
  previsit_blockers: number;
  undrafted_reports: number;
};

type BillingAnalytics = {
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

export function BillingDashboardContent() {
  const orgId = useOrgId();

  const { data, isLoading } = useQuery({
    queryKey: ['billing-stats', orgId],
    queryFn: async () => {
      const res = await fetch('/api/billing-evidence/stats', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('請求統計の取得に失敗しました');
      return res.json() as Promise<{ data: BillingStats }>;
    },
    enabled: !!orgId,
  });

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ['billing-analytics', orgId],
    queryFn: async () => {
      const res = await fetch('/api/billing-evidence/analytics', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('請求分析の取得に失敗しました');
      return res.json() as Promise<{ data: BillingAnalytics }>;
    },
    enabled: !!orgId,
  });

  const stats = data?.data;
  const analytics = analyticsData?.data;

  return (
    <div className="space-y-6">
      <SectionIntro
        title="月次締めの入口"
        description="まず今月候補、締めブロック、レビュー待ちを確認し、候補一覧へ進むための導入グループです。"
      />
      <Card data-testid="billing-action-strip">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3 text-sm text-blue-900">
              <Info className="mt-0.5 size-4 shrink-0 text-blue-700" aria-hidden="true" />
              <div>
                <p className="font-medium">月次締めの判断を先に行う</p>
                <p className="mt-0.5 text-blue-800">
                  まずレビュー待ちと締めブロックを確認し、その後に候補一覧で確定・除外・CSV出力へ進みます。
                </p>
              </div>
            </div>
            <Link
              href="/billing/candidates"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              候補一覧を開く
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
              <p className="text-xs text-muted-foreground">今月候補</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {stats?.current_month_candidates ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-xs text-rose-700">締めブロック</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-700">
                {stats?.current_month_close_blocked ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs text-amber-700">レビュー待ち</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">
                {stats?.review_required_candidates ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-xs text-emerald-700">締め準備</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">
                {stats?.current_month_close_ready ?? 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <SectionIntro
        title="主要指標"
        description="締め済み、根拠、レビュー待ち、訪問前ブロックなど、今すぐ判断に使う指標をまとめています。"
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              締め済み
            </CardTitle>
            <CardDescription className="text-xs">月次締め済み候補</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span className="text-3xl font-bold tabular-nums">
                {stats?.exported_candidates ?? 0}
              </span>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Info className="size-4" aria-hidden="true" />
              今月の根拠
            </CardTitle>
            <CardDescription className="text-xs">claimable / unclaimable の内訳</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <div className="space-y-1 text-sm">
                <p className="font-semibold tabular-nums">
                  {stats?.current_month_claimable_evidence ?? 0} /{' '}
                  {stats?.current_month_unclaimable_evidence ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">算定可 / 算定不可</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileX className="size-4" aria-hidden="true" />
              レビュー待ち
            </CardTitle>
            <CardDescription className="text-xs">手当てが必要な請求候補</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (stats?.review_required_candidates ?? 0) > 0 ? 'text-orange-600' : ''
                }`}
              >
                {stats?.review_required_candidates ?? 0}
              </span>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertTriangle className="size-4" aria-hidden="true" />
              訪問前ブロック
            </CardTitle>
            <CardDescription className="text-xs">同意・計画書未整備の予定</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (stats?.previsit_blockers ?? 0) > 0 ? 'text-destructive' : ''
                }`}
              >
                {stats?.previsit_blockers ?? 0}
              </span>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileX className="size-4" aria-hidden="true" />
              報告ドラフト滞留
            </CardTitle>
            <CardDescription className="text-xs">送達待ち・下書きの報告書</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (stats?.undrafted_reports ?? 0) > 0 ? 'text-orange-600' : ''
                }`}
              >
                {stats?.undrafted_reports ?? 0}
              </span>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileX className="size-4" aria-hidden="true" />
              開タスク
            </CardTitle>
            <CardDescription className="text-xs">請求根拠レビュー待ち</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span className="text-3xl font-bold tabular-nums">
                {stats?.open_billing_review_tasks ?? 0}
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      <SectionIntro
        title="分析"
        description="月次の成立率、締め進捗、主要請求コードを見て、今月の請求状態を俯瞰します。"
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">今月の算定成立率</CardTitle>
            <CardDescription className="text-xs">
              claimable evidence / 全 billing evidence
            </CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <div className="space-y-1">
                <p className="text-3xl font-bold tabular-nums">
                  {analytics?.summary.current_month_claimable_rate ?? 0}%
                </p>
                <p className="text-xs text-muted-foreground">
                  対象月: {analytics?.summary.current_month ?? '—'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">今月の締め進捗</CardTitle>
            <CardDescription className="text-xs">
              reviewed/excluded/exported を含む close rate
            </CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <div className="space-y-1">
                <p className="text-3xl font-bold tabular-nums">
                  {analytics?.summary.current_month_close_rate ?? 0}%
                </p>
                <p className="text-xs text-muted-foreground">
                  締め済み {analytics?.summary.current_month_exported ?? 0} 件
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">主要請求コード</CardTitle>
            <CardDescription className="text-xs">
              直近6か月で確定または締め済みの上位コード
            </CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="space-y-2">
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
              </div>
            ) : analytics?.top_codes.length ? (
              <div className="space-y-2">
                {analytics.top_codes.slice(0, 3).map((item) => (
                  <div
                    key={`${item.billing_code}:${item.billing_name}`}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.billing_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.billing_code}</p>
                    </div>
                    <Badge variant="outline">{item.count}件</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">まだ請求コード集計がありません。</p>
            )}
          </CardContent>
        </Card>
      </div>

      <SectionIntro
        title="月次推移と主要ブロッカー"
        description="最近の推移と、算定不可の主因を並べて確認する補助グループです。"
      />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">月次推移</CardTitle>
            <CardDescription>
              直近6か月の候補生成、レビュー滞留、締め済みを並べて確認します。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-10 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : analytics?.monthly_trend.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 font-medium">月</th>
                      <th className="px-2 py-2 font-medium">候補</th>
                      <th className="px-2 py-2 font-medium">未レビュー</th>
                      <th className="px-2 py-2 font-medium">締め済み</th>
                      <th className="px-2 py-2 font-medium">算定可</th>
                      <th className="px-2 py-2 font-medium">算定不可</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.monthly_trend.map((row) => (
                      <tr key={row.month} className="border-t border-border/60">
                        <td className="px-2 py-2 font-medium">{row.month}</td>
                        <td className="px-2 py-2 tabular-nums">{row.total_candidates}</td>
                        <td className="px-2 py-2 tabular-nums text-orange-700">
                          {row.review_pending}
                        </td>
                        <td className="px-2 py-2 tabular-nums text-sky-700">{row.exported}</td>
                        <td className="px-2 py-2 tabular-nums text-green-700">
                          {row.claimable_evidence}
                        </td>
                        <td className="px-2 py-2 tabular-nums text-rose-700">
                          {row.unclaimable_evidence}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">月次推移データはまだありません。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">主要ブロッカー</CardTitle>
            <CardDescription>算定不可の主因を上位から表示します。</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="space-y-2">
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            ) : analytics?.blocker_reasons.length ? (
              <div className="space-y-3">
                {analytics.blocker_reasons.map((item) => (
                  <div
                    key={item.reason}
                    className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm"
                  >
                    <p className="min-w-0 text-foreground">{item.reason}</p>
                    <Badge variant="secondary">{item.count}件</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">現在の算定ブロッカーはありません。</p>
            )}
          </CardContent>
        </Card>
      </div>

      <SectionIntro
        title="実行ワークベンチ"
        description="最終的な確定、除外、締め、CSV 出力へ進むアクションをここでまとめます。"
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">月次締めワークベンチ</CardTitle>
          <CardDescription>
            レビュー待ちの解消、月次締め、CSV 出力は候補一覧から処理します。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm md:flex-row md:items-center md:justify-between">
          <p className="text-muted-foreground">
            未レビュー {stats?.review_required_candidates ?? 0} 件 / 締め準備{' '}
            {stats?.current_month_close_ready ?? 0} 件 / 締め済み {stats?.exported_candidates ?? 0}{' '}
            件
          </p>
          <Link
            href="/billing/candidates"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            候補一覧を開く
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
