'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Info, FileX, XCircle } from 'lucide-react';
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

  const stats = data?.data;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">請求閉鎖の運用ダッシュボード</p>
          <p className="mt-0.5 text-blue-700">
            同意書・計画書・報告送付・SSOT ルールを横断し、月次締め可能件数とレビュー待ちを見える化します。
          </p>
          <p className="mt-1 text-xs text-blue-700">
            公式ルール数: {stats?.ssot_rule_count ?? 0} / 今月候補: {stats?.current_month_candidates ?? 0} / 締め待ち: {stats?.current_month_close_ready ?? 0}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <XCircleIcon />
              締めブロック
            </CardTitle>
            <CardDescription className="text-xs">
              月次締めを止めている候補
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (stats?.current_month_close_blocked ?? 0) > 0 ? 'text-destructive' : ''
                }`}
              >
                {stats?.current_month_close_blocked ?? 0}
              </span>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertTriangle className="size-4" aria-hidden="true" />
              締め準備
            </CardTitle>
            <CardDescription className="text-xs">
              月次締め可能な候補
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (stats?.current_month_close_ready ?? 0) > 0
                    ? 'text-orange-600'
                    : ''
                }`}
              >
                {stats?.current_month_close_ready ?? 0}
              </span>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileX className="size-4" aria-hidden="true" />
              レビュー待ち
            </CardTitle>
            <CardDescription className="text-xs">
              手当てが必要な請求候補
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <span
                className={`text-3xl font-bold tabular-nums ${
                  (stats?.review_required_candidates ?? 0) > 0
                    ? 'text-orange-600'
                    : ''
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
              <CheckCircle2 className="size-4" aria-hidden="true" />
              締め済み
            </CardTitle>
            <CardDescription className="text-xs">
              月次締め済み候補
            </CardDescription>
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
            <CardDescription className="text-xs">
              claimable / unclaimable の内訳
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-12 animate-pulse rounded bg-muted" />
            ) : (
              <div className="space-y-1 text-sm">
                <p className="font-semibold tabular-nums">
                  {stats?.current_month_claimable_evidence ?? 0} / {stats?.current_month_unclaimable_evidence ?? 0}
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
              開タスク
            </CardTitle>
            <CardDescription className="text-xs">
              請求根拠レビュー待ち
            </CardDescription>
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

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertTriangle className="size-4" aria-hidden="true" />
              訪問前ブロック
            </CardTitle>
            <CardDescription className="text-xs">
              同意・計画書未整備の予定
            </CardDescription>
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
            <CardDescription className="text-xs">
              送達待ち・下書きの報告書
            </CardDescription>
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">月次締めワークベンチ</CardTitle>
          <CardDescription>
            レビュー待ちの解消、月次締め、CSV 出力は候補一覧から処理します。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/billing/candidates"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            候補一覧を開く
          </Link>
          <p className="text-muted-foreground">
            未レビュー {stats?.review_required_candidates ?? 0} 件 / 締め準備 {stats?.current_month_close_ready ?? 0} 件 / 締め済み {stats?.exported_candidates ?? 0} 件
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function XCircleIcon() {
  return <XCircle className="size-4" aria-hidden="true" />;
}
