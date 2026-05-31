'use client';

import Link from 'next/link';
import { useEffect, useState, type ElementType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, BellRing, Clock, RefreshCw, Route, Sparkles } from 'lucide-react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminRealtimeShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { parseNotificationStreamPayload } from '@/lib/notifications/stream-payload';

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

const NOTIFICATION_STREAM_DISABLED = process.env.NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM === '1';

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

const TYPE_CONFIG: Record<NotificationType, { label: string; badge: string; icon: ElementType }> = {
  urgent: { label: '緊急', badge: 'border-red-200 bg-red-50 text-red-700', icon: AlertTriangle },
  business: { label: '業務', badge: 'border-blue-200 bg-blue-50 text-blue-700', icon: BellRing },
  reminder: { label: '通知', badge: 'border-amber-200 bg-amber-50 text-amber-700', icon: Clock },
  system: {
    label: 'システム',
    badge: 'border-slate-200 bg-slate-50 text-slate-700',
    icon: Sparkles,
  },
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

export default function RealtimePage() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [isStreamConnected, setIsStreamConnected] = useState(false);

  const workflowQuery = useQuery({
    queryKey: ['admin-realtime-workflow', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/workflow', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ワークフローの取得に失敗しました');
      return res.json() as Promise<{ data: WorkflowSnapshot }>;
    },
    enabled: !!orgId,
    refetchInterval: 15_000,
  });

  const notificationsQuery = useQuery({
    queryKey: ['admin-realtime-notifications', orgId],
    queryFn: async () => {
      const res = await fetch('/api/notifications?limit=12&is_read=false', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('通知の取得に失敗しました');
      return res.json() as Promise<{ data: Notification[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!orgId || NOTIFICATION_STREAM_DISABLED) return;
    const controller = new AbortController();
    let active = true;

    (async () => {
      try {
        const response = await fetch('/api/notifications/stream', {
          headers: { 'x-org-id': orgId },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) return;

        if (active) {
          setIsStreamConnected(true);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';

          for (const chunk of chunks) {
            if (!chunk.startsWith('data: ')) continue;
            const nextNotifications = parseNotificationStreamPayload(chunk.slice(6));
            if (nextNotifications.length > 0) {
              queryClient.setQueryData<{ data: Notification[] }>(
                ['admin-realtime-notifications', orgId],
                (current) => ({
                  data: mergeNotifications(current?.data ?? [], nextNotifications),
                }),
              );
            }
          }
        }
      } catch {
        // Network aborts and reconnects fall back to the periodic query refresh.
      } finally {
        if (active) {
          setIsStreamConnected(false);
        }
      }
    })();

    return () => {
      active = false;
      setIsStreamConnected(false);
      controller.abort();
    };
  }, [orgId, queryClient]);

  const workflow = workflowQuery.data?.data;
  const notifications = notificationsQuery.data?.data ?? [];
  const workbenchItems = workflow?.unified_workbench ?? [];
  const liveNotifications = notifications.slice(0, 8);

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
    <div className="space-y-6">
      <AdminPageHeader
        title="リアルタイム運用監視"
        description="通知ストリームとワークフロー制御を同じ面で追跡し、遅延や割込影響を即時確認します。"
        shortcuts={getAdminRealtimeShortcutLinks()}
      />
      <Card className="overflow-hidden border-none bg-[linear-gradient(135deg,rgba(15,23,42,1),rgba(30,41,59,1))] text-white shadow-lg">
        <CardContent className="grid gap-5 px-5 py-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
              Live Operations
            </p>
            <h2 className="mt-2 text-xl font-semibold">通知と訪問制御を同じ運用面で監視</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              通知は SSE で即時反映し、ワークフローは定期再取得で補完して、
              確定ロック、変更承認待ち、緊急影響を継続監視します。
            </p>
          </div>
          <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-300">未読通知</span>
              <span className="font-medium">{liveNotifications.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-300">ワークベンチ</span>
              <span className="font-medium">{workbenchItems.length}</span>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              {isStreamConnected
                ? 'SSE 接続中です。新着通知は即時反映されます。'
                : 'SSE 再接続中です。未接続時は定期再取得へフォールバックします。'}
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {routeHealth.map((item) => (
          <Card key={item.title}>
            <CardContent className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{item.title}</p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{item.value}</p>
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
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最新通知</CardTitle>
            <CardDescription>未読通知を中心に、直近の運用イベントを確認します</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {notificationsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">通知を読み込んでいます...</p>
            ) : liveNotifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">未読通知はありません</p>
            ) : (
              liveNotifications.map((notification) => {
                const config = TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.system;
                const Icon = config.icon;
                return (
                  <div
                    key={notification.id}
                    className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-border bg-background p-2">
                          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={config.badge}>
                              {config.label}
                            </Badge>
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
                        className="text-xs font-medium text-primary hover:underline"
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ライブワークベンチ</CardTitle>
            <CardDescription>優先度順に処理すべき運用項目です</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {workflowQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">ワークベンチを読み込んでいます...</p>
            ) : workbenchItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">未処理項目はありません</p>
            ) : (
              workbenchItems.slice(0, 10).map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border/70 bg-background px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{item.queue_label}</Badge>
                        <Badge variant={item.priority === 'urgent' ? 'destructive' : 'secondary'}>
                          {item.priority}
                        </Badge>
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
                      className="ml-auto text-xs font-medium text-primary hover:underline"
                    >
                      {item.action_label}
                    </Link>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
