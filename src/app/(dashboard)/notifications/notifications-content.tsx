'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Bell, BellOff, CheckCheck, ExternalLink, AlertTriangle, Clock, Cpu } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { badgeToneClass } from '@/lib/ui/badge-semantics';
import { SectionIntro } from '@/components/ui/section-intro';
import type {
  HomeLinkContext,
  NotificationTab,
  NotificationTypeFilter,
} from '@/lib/dashboard/home-link-builders';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';

// --- Types ---

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

// --- Constants ---

const TYPE_CONFIG: Record<
  NotificationType,
  { label: string; icon: React.ElementType; badgeClass: string }
> = {
  urgent: {
    label: '緊急',
    icon: AlertTriangle,
    badgeClass: badgeToneClass('urgent'),
  },
  business: { label: '業務', icon: Bell, badgeClass: badgeToneClass('info') },
  reminder: {
    label: 'リマインダー',
    icon: Clock,
    badgeClass: badgeToneClass('attention'),
  },
  system: { label: 'システム', icon: Cpu, badgeClass: badgeToneClass('neutral') },
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
  return unique.slice(0, 50);
}

// --- Helpers ---

function NotificationCard({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: (id: string) => void;
}) {
  const cfg = TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.system;
  const Icon = cfg.icon;

  const timeAgo = formatDistanceToNow(parseISO(notification.created_at), {
    addSuffix: true,
    locale: ja,
  });

  return (
    <Card className={notification.is_read ? 'opacity-70' : 'border-blue-200 bg-blue-50/30'}>
      <CardContent className="flex items-start gap-3 p-4">
        <div
          className={`mt-0.5 rounded-full p-1.5 ${notification.is_read ? 'bg-muted' : 'bg-blue-100'}`}
        >
          <Icon
            className={`size-4 ${notification.is_read ? 'text-muted-foreground' : 'text-blue-700'}`}
            aria-hidden="true"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`text-[10px] ${cfg.badgeClass}`}>
              {cfg.label}
            </Badge>
            {!notification.is_read && (
              <span className="inline-block size-2 rounded-full bg-blue-600" aria-label="未読" />
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">{notification.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{notification.message}</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
            {notification.link && (
              <Link
                href={notification.link}
                className="flex items-center gap-1 text-xs text-blue-700 hover:underline"
              >
                詳細を見る
                <ExternalLink className="size-3" aria-hidden="true" />
              </Link>
            )}
            {!notification.is_read && (
              <button
                onClick={() => onRead(notification.id)}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                既読にする
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Main ---

type NotificationsContentProps = {
  initialTab?: NotificationTab;
  initialTypeFilter?: NotificationTypeFilter;
  initialContext?: HomeLinkContext | null;
};

export function NotificationsContent({
  initialTab = 'unread',
  initialTypeFilter = 'all',
  initialContext,
}: NotificationsContentProps = {}) {
  const replaceNotificationsUrl = useSyncedSearchParams();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'unread' | 'all'>(initialTab);
  const [typeFilter, setTypeFilter] = useState<'all' | NotificationType>(initialTypeFilter);

  const { data: unreadData, isLoading: unreadLoading } = useQuery({
    queryKey: ['notifications', orgId, 'unread'],
    queryFn: async () => {
      const res = await fetch('/api/notifications?is_read=false&limit=50', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('通知の取得に失敗しました');
      return res.json() as Promise<{ data: Notification[] }>;
    },
    enabled: !!orgId,
  });

  const { data: allData, isLoading: allLoading } = useQuery({
    queryKey: ['notifications', orgId, 'all'],
    queryFn: async () => {
      const res = await fetch('/api/notifications?limit=50', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('通知の取得に失敗しました');
      return res.json() as Promise<{ data: Notification[] }>;
    },
    enabled: !!orgId && tab === 'all',
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
            try {
              const nextNotifications = JSON.parse(chunk.slice(6)) as Notification[];
              queryClient.setQueryData<{ data: Notification[] }>(
                ['notifications', orgId, 'unread'],
                (current) => ({
                  data: mergeNotifications(current?.data ?? [], nextNotifications),
                }),
              );
              queryClient.setQueryData<{ data: Notification[] }>(
                ['notifications', orgId, 'all'],
                (current) => ({
                  data: mergeNotifications(current?.data ?? [], nextNotifications),
                }),
              );
            } catch {
              // Ignore malformed SSE payloads and keep the stream alive.
            }
          }
        }
      } catch {
        // Unmounts and transient reconnects are handled by the next page visit.
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [orgId, queryClient]);

  const markReadMutation = useMutation({
    mutationFn: async ({ ids, all }: { ids?: string[]; all?: boolean }) => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ ids, all }),
      });
      if (!res.ok) throw new Error('既読更新に失敗しました');
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', orgId] });
      if (variables.all) {
        toast.success('全て既読にしました');
      }
    },
    onError: () => toast.error('既読更新に失敗しました'),
  });

  const unreadNotifications = unreadData?.data ?? [];
  const allNotifications = allData?.data ?? [];

  function handleRead(id: string) {
    markReadMutation.mutate({ ids: [id] });
  }

  function handleReadAll() {
    markReadMutation.mutate({ all: true });
  }

  const currentList = tab === 'unread' ? unreadNotifications : allNotifications;
  const filteredList =
    typeFilter === 'all'
      ? currentList
      : currentList.filter((notification) => notification.type === typeFilter);
  const isLoading = tab === 'unread' ? unreadLoading : allLoading;
  const contextSummary =
    initialContext === 'dashboard_home'
      ? tab === 'unread' && typeFilter === 'urgent'
        ? 'ホームから未読の緊急通知にフォーカスして開いています。'
        : tab === 'unread'
          ? 'ホームから未読通知にフォーカスして開いています。'
          : 'ホームから通知一覧にフォーカスして開いています。'
      : null;

  return (
    <div className="space-y-6">
      {contextSummary ? (
        <Alert
          className="border-sky-200 bg-sky-50 text-sky-900"
          data-testid="notifications-context-banner"
        >
          <Bell className="size-4 text-sky-700" aria-hidden="true" />
          <AlertDescription className="text-sky-800">{contextSummary}</AlertDescription>
        </Alert>
      ) : null}
      <SectionIntro
        title="絞り込み"
        description="未読・全件・通知種別で先に絞り込み、処理すべき通知だけを残します。"
      />
      <div className="flex items-center justify-between">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            const nextTab = v as 'unread' | 'all';
            setTab(nextTab);
            replaceNotificationsUrl({ tab: nextTab === 'unread' ? null : nextTab });
          }}
        >
          <TabsList>
            <TabsTrigger value="unread" className="min-w-[44px]">
              未読
              {unreadNotifications.length > 0 && (
                <Badge className="ml-1.5 h-4 min-w-[1rem] px-1 text-[10px] bg-blue-600">
                  {unreadNotifications.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all">すべて</TabsTrigger>
          </TabsList>
        </Tabs>

        {unreadNotifications.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleReadAll}
            disabled={markReadMutation.isPending}
          >
            <CheckCheck className="mr-1.5 size-3.5" aria-hidden="true" />
            全て既読
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={typeFilter === 'all' ? 'default' : 'outline'}
          onClick={() => {
            setTypeFilter('all');
            replaceNotificationsUrl({ type: null });
          }}
        >
          すべて
          <Badge variant="secondary" className="ml-1.5">
            {currentList.length}
          </Badge>
        </Button>
        {(Object.keys(TYPE_CONFIG) as NotificationType[]).map((type) => {
          const count = currentList.filter((notification) => notification.type === type).length;
          return (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={typeFilter === type ? 'default' : 'outline'}
              onClick={() => {
                setTypeFilter(type);
                replaceNotificationsUrl({ type });
              }}
            >
              {TYPE_CONFIG[type].label}
              <Badge variant="secondary" className="ml-1.5">
                {count}
              </Badge>
            </Button>
          );
        })}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {!isLoading && filteredList.length === 0 && (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-center">
          <BellOff className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {typeFilter === 'all'
              ? tab === 'unread'
                ? '未読の通知はありません'
                : '通知はありません'
              : `${TYPE_CONFIG[typeFilter].label}の通知はありません`}
          </p>
        </div>
      )}

      <SectionIntro
        title="通知一覧"
        description="絞り込み後の通知を、未読と重要度を見ながら順に処理します。"
      />
      <div className="space-y-2">
        {filteredList.map((notification) => (
          <NotificationCard key={notification.id} notification={notification} onRead={handleRead} />
        ))}
      </div>
    </div>
  );
}
