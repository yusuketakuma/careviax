'use client';

import { useQuery } from '@tanstack/react-query';
import type { ElementType } from 'react';
import { Activity, BellRing, FileCheck2, Route, ShieldAlert, Timer } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HelpPopover } from '@/components/ui/help-popover';
import { useOrgId } from '@/lib/hooks/use-org-id';

type WorkflowSnapshot = {
  workflow_exceptions: { open: number };
  operations_queue: {
    callback_followups: number;
    preparation_pending: number;
    self_reports_triage: number;
  };
  outcome_metrics: {
    completed_last_7_days: number;
    disrupted_last_7_days: number;
    urgent_completed_last_7_days: number;
    awaiting_reports: number;
  };
  route_control?: {
    locked_schedules: number;
    pending_override_requests: number;
    emergency_impact_items: number;
  };
};

type BillingStats = {
  current_month_candidates?: number;
  current_month_close_ready?: number;
  current_month_close_blocked?: number;
  exported_candidates?: number;
  open_billing_review_tasks?: number;
};

function MetricCard({
  title,
  description,
  value,
  icon: Icon,
}: {
  title: string;
  description: string;
  value: number;
  icon: ElementType;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <HelpPopover title={title} description={description} />
          </div>
          <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{value}</p>
        </div>
        <div className="rounded-full border border-border bg-background p-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

export function PerformanceContent() {
  const orgId = useOrgId();

  const workflowQuery = useQuery({
    queryKey: ['admin-performance-workflow', orgId],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/workflow', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('ワークフローの取得に失敗しました');
      return response.json() as Promise<{ data: WorkflowSnapshot }>;
    },
    enabled: !!orgId,
  });

  const billingQuery = useQuery({
    queryKey: ['admin-performance-billing', orgId],
    queryFn: async () => {
      const response = await fetch('/api/billing-evidence/stats', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('請求統計の取得に失敗しました');
      return response.json() as Promise<{ data: BillingStats }>;
    },
    enabled: !!orgId,
  });

  const workflow = workflowQuery.data?.data;
  const billing = billingQuery.data?.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          title="完了訪問"
          description="直近7日間の完了件数"
          value={workflow?.outcome_metrics.completed_last_7_days ?? 0}
          icon={Activity}
        />
        <MetricCard
          title="報告待ち"
          description="訪問後の未送付・未完了報告"
          value={workflow?.outcome_metrics.awaiting_reports ?? 0}
          icon={FileCheck2}
        />
        <MetricCard
          title="未処理例外"
          description="運用上の要対応例外"
          value={workflow?.workflow_exceptions.open ?? 0}
          icon={ShieldAlert}
        />
        <MetricCard
          title="再架電待ち"
          description="折返し・再架電タスク"
          value={workflow?.operations_queue.callback_followups ?? 0}
          icon={BellRing}
        />
        <MetricCard
          title="ルート影響"
          description="緊急割込や承認待ちの影響件数"
          value={
            (workflow?.route_control?.pending_override_requests ?? 0) +
            (workflow?.route_control?.emergency_impact_items ?? 0)
          }
          icon={Route}
        />
        <MetricCard
          title="締め準備完了"
          description="当月の請求締め可能候補"
          value={billing?.current_month_close_ready ?? 0}
          icon={Timer}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">運用の停滞ポイント</CardTitle>
            <CardDescription>件数の多い滞留箇所を優先して解消します</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="訪問準備未完了"
              value={workflow?.operations_queue.preparation_pending ?? 0}
            />
            <Row
              label="セルフレポート triage"
              value={workflow?.operations_queue.self_reports_triage ?? 0}
            />
            <Row
              label="請求レビュータスク"
              value={billing?.open_billing_review_tasks ?? 0}
            />
            <Row
              label="締めブロック候補"
              value={billing?.current_month_close_blocked ?? 0}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">今週の運用品質</CardTitle>
            <CardDescription>完遂率と例外率の確認用サマリーです</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="完了訪問"
              value={workflow?.outcome_metrics.completed_last_7_days ?? 0}
            />
            <Row
              label="中断・延期"
              value={workflow?.outcome_metrics.disrupted_last_7_days ?? 0}
            />
            <Row
              label="緊急完了"
              value={workflow?.outcome_metrics.urgent_completed_last_7_days ?? 0}
            />
            <Row
              label="当月候補"
              value={billing?.current_month_candidates ?? 0}
            />
            <Row
              label="締め済み"
              value={billing?.exported_candidates ?? 0}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
