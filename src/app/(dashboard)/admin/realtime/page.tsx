'use client';

import Link from 'next/link';
import { useCallback, type ElementType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, BellRing, Clock, RefreshCw, Route, Sparkles } from 'lucide-react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminRealtimeShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { SkeletonRows } from '@/components/ui/loading';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
import { PRIORITY_DISPLAY_LABELS, PRIORITY_ROLE } from '@/lib/constants/status-labels';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { normalizeNotificationStreamPayload } from '@/lib/notifications/stream-payload';

type NotificationType = 'urgent' | 'business' | 'reminder' | 'system';

type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

type WorkflowSnapshot = {
  route_control: {
    locked_schedules: number;
    pending_override_requests: number;
    emergency_impact_items: number;
  };
  workflow_exceptions: {
    open: number;
  };
  unified_workbench: Array<{
    id: string;
    queue_label: string;
    title: string;
    summary: string;
    priority: 'urgent' | 'high' | 'normal' | 'low';
    due_at: string | null;
    action_href: string;
    action_label: string;
    patient_name: string | null;
    badges: string[];
  }>;
};

const TYPE_CONFIG: Record<
  NotificationType,
  { label: string; role: StatusRole; icon: ElementType }
> = {
  urgent: { label: '緊急', role: 'blocked', icon: AlertTriangle },
  business: { label: '業務', role: 'info', icon: BellRing },
  reminder: { label: '通知', role: 'confirm', icon: Clock },
  system: { label: 'システム', role: 'readonly', icon: Sparkles },
};

function mergeNotifications(current: Notification[], incoming: Notification[]) {
  const merged = [...incoming, ...current];
  const unique = merged.filter(
    (notification, index, all) =>
      all.findIndex((candidate) => candidate.id === notification.id) === index,
  );
  unique.sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );
  return unique.slice(0, 12);
}

const ADMIN_REALTIME_WORKFLOW_EVENTS = ['workflow_refresh', 'cycle_transition'] as const;

export default function RealtimePage() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const handleNotificationRealtimeEvent = useCallback(
    (event: unknown) => {
      const nextNotifications = normalizeNotificationStreamPayload(event);
      if (nextNotifications.length === 0) return;

      queryClient.setQueryData<{ data: Notification[] }>(
        ['admin-realtime-notifications', orgId],
        (current) => ({
          data: mergeNotifications(current?.data ?? [], nextNotifications),
        }),
      );
    },
    [orgId, queryClient],
  );

  const workflowQuery = useRealtimeQuery({
    queryKey: ['admin-realtime-workflow', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/workflow?view=realtime', {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('ワークフローの取得に失敗しました');
      return res.json() as Promise<{ data: WorkflowSnapshot }>;
    },
    enabled: !!orgId,
    invalidateOn: ADMIN_REALTIME_WORKFLOW_EVENTS,
    fallbackRefetchInterval: 15_000,
  });

  const notificationsQuery = useRealtimeQuery({
    queryKey: ['admin-realtime-notifications', orgId],
    queryFn: async () => {
      const res = await fetch('/api/notifications?limit=12&is_read=false', {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('通知の取得に失敗しました');
      return res.json() as Promise<{ data: Notification[] }>;
    },
    enabled: !!orgId,
    invalidateOn: false,
    fallbackRefetchInterval: 60_000,
    onRealtimeEvent: handleNotificationRealtimeEvent,
  });

  const workflow = workflowQuery.data?.data;
  const notifications = notificationsQuery.data?.data ?? [];
  const workbenchItems = workflow?.unified_workbench ?? [];
  const liveNotifications = notifications.slice(0, 8);
  const realtimeConnected = workflowQuery.connected || notificationsQuery.connected;
  const urgentNotifications = liveNotifications.filter(
    (notification) => notification.type === 'urgent',
  );
  const priorityWorkbenchItems = workbenchItems.filter(
    (item) => item.priority === 'urgent' || item.priority === 'high',
  );
  // 上部「今すぐ見る運用シグナル」の workflow 由来 KPI も、下部「ルート・例外 KPI」(line 222) と
  // 同様に取得失敗を 0 (false-zero) 表示しない。0 表示だと承認待ち/未処理例外が「なし」に化けて
  // 偽 all-clear になるため、取得失敗時は '—' + 取得失敗表示にする(再読み込みは直下の ErrorState)。
  const workflowUnavailable = workflowQuery.isError;

  const routeHealth = [
    {
      title: '変更承認待ち',
      value: workflow?.route_control.pending_override_requests ?? 0,
      description: '専用リスケでのみ解消されます',
      icon: RefreshCw,
    },
    {
      title: '確定ロック',
      value: workflow?.route_control.locked_schedules ?? 0,
      description: '電話確定済みの訪問です',
      icon: Route,
    },
    {
      title: '緊急影響',
      value: workflow?.route_control.emergency_impact_items ?? 0,
      description: '割込・緊急訪問の影響件数です',
      icon: AlertTriangle,
    },
  ];

  return (
    <PageScaffold variant="bare">
      <AdminPageHeader
        title="リアルタイム運用監視"
        description="通知ストリームとワークフロー制御を同じ面で追跡し、遅延や割込影響を即時確認します。"
        shortcuts={getAdminRealtimeShortcutLinks()}
        supportingContent={null}
      />
      <section className="space-y-3" aria-labelledby="realtime-operation-signals">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="realtime-operation-signals" className="text-base font-semibold text-foreground">
            今すぐ見る運用シグナル
          </h2>
          {/* SYS-4: 接続状態は状態色トークンで示す。再接続中(=ライブ未保証)を常時 done(緑)にすると
              緑=正常の偽シグナルになるため confirm(要注意/橙)へ切替える。文言も併記し色のみ依存にしない。 */}
          <div
            className={`inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-xs font-medium ${
              realtimeConnected
                ? 'border-state-done/20 bg-state-done/10 text-state-done'
                : 'border-state-confirm/20 bg-state-confirm/10 text-state-confirm'
            }`}
          >
            {realtimeConnected
              ? 'SSE 接続中です。新着通知は即時反映されます。'
              : 'SSE 再接続中です。未接続時は定期再取得へフォールバックします。'}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border-l-4 border-border/70 border-l-state-blocked bg-card px-4 py-3">
            <p className="text-sm font-medium text-state-blocked">至急通知</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
              {urgentNotifications.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              未読通知 {liveNotifications.length} 件
            </p>
          </div>
          <div className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3">
            <p className="text-sm font-medium text-state-confirm">高優先ワークベンチ</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
              {workflowUnavailable ? '—' : priorityWorkbenchItems.length}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {workflowUnavailable ? '取得に失敗しました' : `全項目 ${workbenchItems.length} 件`}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-4 py-3">
            <p className="text-sm font-medium text-muted-foreground">変更承認待ち</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
              {workflowUnavailable ? '—' : (workflow?.route_control.pending_override_requests ?? 0)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {workflowUnavailable ? '取得に失敗しました' : '専用リスケで処理'}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background px-4 py-3">
            <p className="text-sm font-medium text-muted-foreground">未処理例外</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
              {workflowUnavailable ? '—' : (workflow?.workflow_exceptions.open ?? 0)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {workflowUnavailable ? '取得に失敗しました' : 'ワークフロー例外'}
            </p>
          </div>
        </div>
      </section>

      {workflowQuery.isError ? (
        // ワークフロー取得失敗時は KPI を 0 (false-zero) 表示せず、再読み込み導線つきの ErrorState を出す。
        <ErrorState
          variant="server"
          size="inline"
          onRetry={() => void workflowQuery.refetch()}
          retryLabel="再読み込み"
        />
      ) : (
        <section className="space-y-3" aria-labelledby="realtime-route-health">
          <h2 id="realtime-route-health" className="text-base font-semibold text-foreground">
            ルート・例外 KPI
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {routeHealth.map((item) => (
              <Card key={item.title}>
                <CardContent className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{item.title}</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
                      {item.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <div className="rounded-full border border-border bg-background p-2">
                    <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardContent className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">未処理例外</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">
                    {workflow?.workflow_exceptions.open ?? 0}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">ワークフロー例外</p>
                </div>
                <div className="rounded-full border border-border bg-background p-2">
                  <AlertTriangle className="size-4 text-muted-foreground" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ライブワークベンチ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {workflowQuery.isLoading ? (
              <div role="status" aria-label="ワークベンチを読み込み中" aria-live="polite">
                <SkeletonRows rows={3} cols={3} status={false} />
              </div>
            ) : workflowQuery.isError ? (
              // 取得失敗時は空状態（false-empty）にせず、再読み込み導線つきの ErrorState を出す。
              <ErrorState
                variant="server"
                size="inline"
                onRetry={() => void workflowQuery.refetch()}
                retryLabel="再読み込み"
              />
            ) : workbenchItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">未処理項目はありません</p>
            ) : (
              workbenchItems.slice(0, 10).map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border/70 bg-background px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{item.queue_label}</Badge>
                        <StateBadge
                          role={
                            (PRIORITY_ROLE[item.priority] as StatusRole | 'neutral') === 'neutral'
                              ? 'info'
                              : (PRIORITY_ROLE[item.priority] as StatusRole)
                          }
                        >
                          {PRIORITY_DISPLAY_LABELS[item.priority] ?? item.priority}
                        </StateBadge>
                      </div>
                      <p className="mt-2 font-medium text-foreground">{item.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {item.due_at ? (
                        <p>
                          {formatDistanceToNow(parseISO(item.due_at), {
                            addSuffix: true,
                            locale: ja,
                          })}
                        </p>
                      ) : (
                        <p>期限未設定</p>
                      )}
                      {item.patient_name ? <p className="mt-1">{item.patient_name}</p> : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {item.badges.map((badge) => (
                      <Badge key={badge} variant="outline" className="text-xs">
                        {badge}
                      </Badge>
                    ))}
                    <Link
                      href={item.action_href}
                      className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.action_label}
                    </Link>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">最新通知</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {notificationsQuery.isLoading ? (
              <div role="status" aria-label="通知を読み込み中" aria-live="polite">
                <SkeletonRows rows={3} cols={2} status={false} />
              </div>
            ) : notificationsQuery.isError ? (
              // 取得失敗時は空状態（false-empty）にせず、再読み込み導線つきの ErrorState を出す。
              <ErrorState
                variant="server"
                size="inline"
                onRetry={() => void notificationsQuery.refetch()}
                retryLabel="再読み込み"
              />
            ) : liveNotifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">未読通知はありません</p>
            ) : (
              liveNotifications.map((notification) => {
                const config = TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.system;
                const Icon = config.icon;
                return (
                  <div
                    key={notification.id}
                    className="space-y-2 rounded-lg border border-border/70 bg-muted/20 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-border bg-background p-2">
                          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StateBadge role={config.role}>{config.label}</StateBadge>
                            {!notification.is_read ? <Badge variant="secondary">未読</Badge> : null}
                          </div>
                          <p className="mt-1 font-medium text-foreground">{notification.title}</p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(parseISO(notification.created_at), {
                          addSuffix: true,
                          locale: ja,
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{notification.message}</p>
                    {notification.link ? (
                      <Link
                        href={notification.link}
                        className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        詳細を開く
                      </Link>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </PageScaffold>
  );
}
