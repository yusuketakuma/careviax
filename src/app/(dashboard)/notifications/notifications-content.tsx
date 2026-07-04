'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Loading } from '@/components/ui/loading';
import { FilterChipBar } from '@/components/features/workspace/filter-chip-bar';
import { ListOpenCard } from '@/components/features/workspace/list-open-card';
import {
  classifyNotification,
  NOTIFICATION_CATEGORY_BADGE_CLASSES,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
} from '@/lib/notifications/notification-category';
import { useOfflineStore } from '@/lib/stores/offline-store';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { NOTIFICATIONS_API_PATH, buildNotificationsApiPath } from '@/lib/notifications/api-paths';
import { normalizeNotificationStreamPayload } from '@/lib/notifications/stream-payload';
import { messageFromError } from '@/lib/utils/error-message';
import type { NotificationCategoryFilter } from './notifications-query-state';

/**
 * p0_04「お知らせ一覧」。
 * 急ぎ / 薬剤師確認 / 事務で対応 / 返信待ち / 未同期 のフィルタチップと、
 * バッジ+タイトル+「患者名様:補足」+「開く」のカードリスト。
 * 「未同期」はサーバー通知ではなく offline-store からの合成行。
 */

type NotificationItem = {
  id: string;
  type: string;
  event_type?: string | null;
  title?: string | null;
  message: string;
  link?: string | null;
  created_at: string;
  is_read: boolean;
};

const CATEGORY_FILTERS: NotificationCategoryFilter[] = [
  'all',
  'urgent',
  'pharmacist',
  'clerk',
  'reply',
  'unsynced',
];

type NotificationsContentProps = {
  initialCategory?: NotificationCategoryFilter;
};

function mergeNotificationItems(current: NotificationItem[], incoming: NotificationItem[]) {
  return [...incoming, ...current]
    .filter(
      (notification, index, all) =>
        all.findIndex((candidate) => candidate.id === notification.id) === index,
    )
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, 50);
}

export function NotificationsContent({ initialCategory = 'all' }: NotificationsContentProps) {
  const orgId = useOrgId();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<NotificationCategoryFilter>(initialCategory);
  const pendingSyncCount = useOfflineStore((state) => state.pendingSyncCount);
  const refreshSyncCount = useOfflineStore((state) => state.refreshSyncCount);

  // オフラインストアは record/offline-sync ページでしか hydrate されないため、直接遷移や
  // リロードで /notifications を開くと pendingSyncCount が初期値 0 のままになり、
  // IndexedDB に未同期の医療記録が残っていても「未同期 N件」行が抑制されてしまう。
  // マウント時に一度 IndexedDB の実状態を読み込み、未同期件数を正しく反映する。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    void refreshSyncCount().catch((error) => {
      console.warn('[notifications] pending sync count refresh failed', error);
    });
  }, [refreshSyncCount]);

  const handleRealtimeEvent = useCallback(
    (event: unknown) => {
      const nextNotifications = normalizeNotificationStreamPayload(event);
      if (nextNotifications.length === 0) return;

      queryClient.setQueryData<{ data: NotificationItem[] }>(
        ['notifications', 'inbox', orgId],
        (current) => ({
          data: mergeNotificationItems(current?.data ?? [], nextNotifications),
        }),
      );
    },
    [orgId, queryClient],
  );

  const { data, isLoading, isError, refetch } = useRealtimeQuery<{ data: NotificationItem[] }>({
    queryKey: ['notifications', 'inbox', orgId],
    queryFn: async () => {
      const res = await fetch(buildNotificationsApiPath(new URLSearchParams({ limit: '50' })), {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('お知らせの取得に失敗しました');
      return res.json();
    },
    enabled: Boolean(orgId),
    fallbackRefetchInterval: 30_000,
    invalidateOn: false,
    onRealtimeEvent: handleRealtimeEvent,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch(NOTIFICATIONS_API_PATH, {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error('既読化に失敗しました');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '既読化に失敗しました'));
    },
  });

  const notifications = useMemo(() => data?.data ?? [], [data]);

  const classified = useMemo(() => {
    const categoryRank: Record<string, number> = {
      urgent: 0,
      clerk: 1,
      pharmacist: 2,
      reply: 3,
    };
    return notifications
      .map((notification) => ({
        notification,
        category: classifyNotification(notification),
      }))
      .sort((a, b) => {
        // 未読優先 → 急ぎ等の重要度 → 新しい順
        if (a.notification.is_read !== b.notification.is_read) {
          return a.notification.is_read ? 1 : -1;
        }
        const rankA = a.category ? (categoryRank[a.category] ?? 4) : 5;
        const rankB = b.category ? (categoryRank[b.category] ?? 4) : 5;
        if (rankA !== rankB) return rankA - rankB;
        return +new Date(b.notification.created_at) - +new Date(a.notification.created_at);
      });
  }, [notifications]);

  const countByCategory = useMemo(() => {
    const counts = new Map<NotificationCategory, number>();
    for (const { notification, category: itemCategory } of classified) {
      if (!itemCategory || notification.is_read) continue;
      counts.set(itemCategory, (counts.get(itemCategory) ?? 0) + 1);
    }
    return counts;
  }, [classified]);

  const handleCategoryChange = (next: NotificationCategoryFilter) => {
    setCategory(next);
    const params = new URLSearchParams();
    if (next === 'all') {
      params.delete('category');
    } else {
      params.set('category', next);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const visibleItems = classified.filter(({ category: itemCategory }) => {
    if (category === 'all') return true;
    if (category === 'unsynced') return false;
    return itemCategory === category;
  });

  const showUnsyncedRow = pendingSyncCount > 0 && (category === 'all' || category === 'unsynced');

  const unreadIds = notifications
    .filter((notification) => !notification.is_read)
    .map((notification) => notification.id);

  const openNotification = (notification: NotificationItem) => {
    if (!notification.is_read) {
      markReadMutation.mutate([notification.id]);
    }
    if (notification.link) {
      router.push(notification.link);
    }
  };

  if (!orgId || isLoading) return <Loading label="お知らせを読み込み中..." />;

  return (
    <div className="w-full space-y-5" data-testid="notifications-inbox">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">お知らせ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            急ぎの確認、返信待ち、未同期をまとめて見ます。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="!h-auto !min-h-11"
          onClick={() => markReadMutation.mutate(unreadIds)}
          disabled={unreadIds.length === 0 || markReadMutation.isPending}
        >
          全て既読にする
        </Button>
      </div>

      <FilterChipBar
        ariaLabel="お知らせの絞り込み"
        value={category}
        onChange={handleCategoryChange}
        options={CATEGORY_FILTERS.map((value) => ({
          value,
          label: value === 'all' ? 'すべて' : NOTIFICATION_CATEGORY_LABELS[value],
          count:
            value === 'all'
              ? undefined
              : value === 'unsynced'
                ? pendingSyncCount || undefined
                : countByCategory.get(value),
        }))}
      />

      <div className="space-y-3" role="list" aria-label="お知らせ一覧">
        {isError ? (
          <ErrorState
            variant="server"
            title="お知らせを表示できません"
            description="急ぎの確認、返信待ち、未読件数の取得に失敗しました。再試行してください。"
            detail="取得失敗を「お知らせなし」と区別するため、一覧の操作を停止しています。"
            onRetry={() => void refetch()}
            headingLevel={3}
          />
        ) : null}

        {!isError && showUnsyncedRow && (
          <ListOpenCard
            badgeLabel={NOTIFICATION_CATEGORY_LABELS.unsynced}
            badgeClassName={NOTIFICATION_CATEGORY_BADGE_CLASSES.unsynced}
            title="送信できていない記録があります"
            subtitle={`未同期 ${pendingSyncCount} 件。通信が戻ったら自動で再送します。`}
            onOpen={() => router.push('/schedules')}
          />
        )}

        {!isError && visibleItems.length === 0 && !showUnsyncedRow ? (
          <EmptyState icon={BellOff} title="この分類のお知らせはありません" />
        ) : !isError ? (
          visibleItems.map(({ notification, category: itemCategory }) => {
            return (
              <ListOpenCard
                key={notification.id}
                badgeLabel={itemCategory ? NOTIFICATION_CATEGORY_LABELS[itemCategory] : 'お知らせ'}
                badgeClassName={
                  itemCategory ? NOTIFICATION_CATEGORY_BADGE_CLASSES[itemCategory] : undefined
                }
                title={notification.title ?? notification.message}
                subtitle={notification.title ? notification.message : null}
                highlighted={!notification.is_read}
                onOpen={() => openNotification(notification)}
              />
            );
          })
        ) : null}
      </div>
    </div>
  );
}
