'use client';

import { useQuery } from '@tanstack/react-query';
import type { ElementType } from 'react';
import { Bell, CalendarClock, Route, Siren } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HelpPopover } from '@/components/ui/help-popover';
import { useOrgId } from '@/lib/hooks/use-org-id';

type WorkflowSnapshot = {
  operations_queue: {
    callback_followups: number;
    self_reports_triage: number;
  };
  outcome_metrics: {
    awaiting_reports: number;
  };
  route_control?: {
    locked_schedules: number;
    pending_override_requests: number;
    emergency_impact_items: number;
  };
  unified_workbench: Array<{
    id: string;
    title: string;
    queue_label: string;
    priority: string;
    action_href: string;
  }>;
};

type Notification = {
  id: string;
  title: string;
  message: string;
  type: string;
  created_at: string;
  link: string | null;
};

export function RealtimeContent() {
  const orgId = useOrgId();

  const workflowQuery = useQuery({
    queryKey: ['admin-realtime-workflow', orgId],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/workflow?view=realtime', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('リアルタイム運用情報の取得に失敗しました');
      return response.json() as Promise<{ data: WorkflowSnapshot }>;
    },
    enabled: !!orgId,
    refetchInterval: 5000,
  });

  const notificationsQuery = useQuery({
    queryKey: ['admin-realtime-notifications', orgId],
    queryFn: async () => {
      const response = await fetch('/api/notifications?is_read=false&limit=8', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('通知の取得に失敗しました');
      return response.json() as Promise<{ data: Notification[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 5000,
  });

  const workflow = workflowQuery.data?.data;
  const notifications = notificationsQuery.data?.data ?? [];
  const urgentItems = (workflow?.unified_workbench ?? []).filter(
    (item) => item.priority === 'urgent',
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="緊急影響"
          description="割込・再配置の影響件数"
          value={workflow?.route_control?.emergency_impact_items ?? 0}
          icon={Siren}
        />
        <MetricCard
          title="承認待ち変更"
          description="確定後変更の承認待ち"
          value={workflow?.route_control?.pending_override_requests ?? 0}
          icon={Route}
        />
        <MetricCard
          title="固定済み予定"
          description="本日以降に lock 扱いの予定"
          value={workflow?.route_control?.locked_schedules ?? 0}
          icon={CalendarClock}
        />
        <MetricCard
          title="未読通知"
          description="5秒ごとに更新"
          value={notifications.length}
          icon={Bell}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">優先ワークキュー</CardTitle>
            <CardDescription>緊急度の高い workbench 項目を即時確認します</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {urgentItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">緊急キューはありません。</p>
            ) : (
              urgentItems.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <Badge variant="outline">{item.queue_label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.action_href}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">未読通知</CardTitle>
              <CardDescription>通知 API をポーリングして一覧化します</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">未読通知はありません。</p>
              ) : (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">{notification.title}</p>
                      <Badge variant="outline">{notification.type}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{notification.message}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">滞留中の即応項目</CardTitle>
              <CardDescription>
                再架電・セルフレポート・報告待ちをまとめて確認します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SummaryRow
                label="再架電待ち"
                value={workflow?.operations_queue.callback_followups ?? 0}
              />
              <SummaryRow
                label="セルフレポート triage"
                value={workflow?.operations_queue.self_reports_triage ?? 0}
              />
              <SummaryRow
                label="訪問後の報告待ち"
                value={workflow?.outcome_metrics.awaiting_reports ?? 0}
              />
              <SummaryRow
                label="ルート影響件数"
                value={workflow?.route_control?.emergency_impact_items ?? 0}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

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

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
