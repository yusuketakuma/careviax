'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Receipt, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

type BillingKpiSummary = {
  total: number;
  pending_review: number;
  confirmed: number;
  excluded: number;
  exported: number;
  reviewed: number;
  ready_to_close: number;
  blocked_from_close: number;
  blocker_reasons: Array<{ reason: string; count: number }>;
};

export function BillingKpiSection() {
  const orgId = useOrgId();
  const billingMonth = format(new Date(), 'yyyy-MM-01');

  const { data } = useQuery({
    queryKey: ['billing-kpi', orgId, billingMonth],
    queryFn: async () => {
      const res = await fetch(`/api/billing-candidates?billing_month=${billingMonth}&limit=1`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as { summary: BillingKpiSummary | null };
      return payload.summary;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });

  if (!data) return null;

  const deliveryIncomplete =
    data.blocker_reasons.find((r) => r.reason === 'delivery_incomplete')?.count ?? 0;
  const notClaimable = data.blocker_reasons.find((r) => r.reason === 'not_claimable')?.count ?? 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm" className="border-primary/15 bg-primary/[0.04] shadow-none">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Receipt className="size-3.5" aria-hidden="true" />
              当月請求候補
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href="/billing/candidates"
              className="text-2xl font-bold tabular-nums transition-colors hover:text-primary"
            >
              {data.total}
            </Link>
            <p className="text-xs text-muted-foreground">件</p>
          </CardContent>
        </Card>

        <Card size="sm" className="border-amber-200/80 bg-amber-500/[0.06] shadow-none">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <AlertTriangle className="size-3.5 text-yellow-500" aria-hidden="true" />
              未確定
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href="/billing/candidates"
              className={`text-2xl font-bold tabular-nums transition-colors ${data.pending_review > 0 ? 'text-yellow-700 hover:text-yellow-800' : 'hover:text-primary'}`}
            >
              {data.pending_review}
            </Link>
            <p className="text-xs text-muted-foreground">レビュー待ち</p>
          </CardContent>
        </Card>

        <Card size="sm" className="border-red-200/80 bg-red-500/[0.06] shadow-none">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <XCircle className="size-3.5 text-red-500" aria-hidden="true" />
              締めブロッカー
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href="/billing/candidates"
              className={`text-2xl font-bold tabular-nums transition-colors ${data.blocked_from_close > 0 ? 'text-red-700 hover:text-red-800' : 'hover:text-primary'}`}
            >
              {data.blocked_from_close}
            </Link>
            <p className="text-xs text-muted-foreground">月次締め不可</p>
          </CardContent>
        </Card>
      </div>

      {(deliveryIncomplete > 0 || notClaimable > 0) && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-amber-200/80 bg-amber-500/[0.08] px-4 py-3 text-xs text-amber-950">
          <CheckCircle2 className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          {deliveryIncomplete > 0 && (
            <span>
              訪問記録未完了: <span className="font-semibold">{deliveryIncomplete}件</span>
            </span>
          )}
          {notClaimable > 0 && (
            <span>
              算定不可: <span className="font-semibold">{notClaimable}件</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
