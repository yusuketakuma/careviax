'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Bell, BellOff, ExternalLink } from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useUIStore } from '@/lib/stores/ui-store';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  getBrowserNotificationPreference,
  isBrowserNotificationSupported,
  showBrowserNotification,
} from '@/lib/browser-notifications';
import { NOTIFICATIONS_API_PATH, buildNotificationsApiPath } from '@/lib/notifications/api-paths';
import { redactNotificationForOsBridge } from '@/lib/notifications/os-bridge-redaction';
import { normalizeNotificationStreamPayload } from '@/lib/notifications/stream-payload';
import { subscribeSharedRealtimeStream } from '@/lib/realtime/shared-event-stream';

type Notification = {
  id: string;
  type: string;
  title?: string;
  message: string;
  link?: string | null;
  created_at: string;
  is_read: boolean;
};

const NOTIFICATION_STREAM_DISABLED = process.env.NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM === '1';
export const NOTIFICATION_DISPLAY_LIMIT = 50;
export const NOTIFICATION_SEEN_ID_LIMIT = 250;

export function pruneSeenNotificationIds(
  seenIds: Set<string>,
  visibleIds: Iterable<string>,
  limit = NOTIFICATION_SEEN_ID_LIMIT,
) {
  if (seenIds.size <= limit) return;
  const visibleIdSet = new Set(visibleIds);

  for (const id of Array.from(seenIds)) {
    if (seenIds.size <= limit) return;
    if (!visibleIdSet.has(id)) {
      seenIds.delete(id);
    }
  }

  for (const id of Array.from(seenIds)) {
    if (seenIds.size <= limit) return;
    seenIds.delete(id);
  }
}

export function NotificationBell() {
  const orgId = useOrgId();
  const { notificationDrawerOpen, setNotificationDrawerOpen } = useUIStore();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadSummaryCount, setUnreadSummaryCount] = useState(0);
  const seenIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const maybeShowBrowserNotifications = useCallback(async (items: Notification[]) => {
    if (
      typeof document === 'undefined' ||
      document.visibilityState !== 'hidden' ||
      !isBrowserNotificationSupported() ||
      Notification.permission !== 'granted' ||
      !getBrowserNotificationPreference()
    ) {
      return;
    }

    for (const item of items) {
      // OS 通知ブリッジ(端末のロック画面 / 通知センター)へは PHI を渡さない。
      // raw な title/message/link は破棄し、種別ベースの汎用文言のみを渡す。
      // 詳細はアプリ内(通知センター)で開く。in-app 表示は従来どおり。
      const redacted = redactNotificationForOsBridge(item);
      await showBrowserNotification({
        title: redacted.title,
        body: redacted.body,
        tag: item.id,
        url: redacted.url,
      });
    }
  }, []);

  const mergeNotifications = useCallback(
    (items: Notification[], options?: { announce?: boolean }) => {
      if (!mountedRef.current) return;
      const unseenItems = items.filter((item) => !seenIdsRef.current.has(item.id));
      for (const item of items) {
        seenIdsRef.current.add(item.id);
      }
      if (options?.announce) {
        void maybeShowBrowserNotifications(unseenItems.filter((item) => !item.is_read));
      }

      setNotifications((prev) => {
        const uniqueById = new Map<string, Notification>();
        for (const notification of prev) {
          uniqueById.set(notification.id, notification);
        }
        for (const notification of items) {
          uniqueById.set(notification.id, notification);
        }
        const unique = [...uniqueById.values()];
        unique.sort(
          (left, right) =>
            new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
        );
        const next = unique.slice(0, NOTIFICATION_DISPLAY_LIMIT);
        pruneSeenNotificationIds(
          seenIdsRef.current,
          next.map((notification) => notification.id),
        );
        return next;
      });
      setUnreadSummaryCount(0);
    },
    [maybeShowBrowserNotifications],
  );

  const refreshNotificationSummary = useCallback(async () => {
    if (!orgId) return;
    const res = await fetch(buildNotificationsApiPath(new URLSearchParams({ summary: '1' })), {
      headers: buildOrgHeaders(orgId),
    });
    if (!res.ok) return;
    const payload = (await res.json()) as { data?: { unreadCount?: number } };
    if (!mountedRef.current) return;
    setUnreadSummaryCount(payload.data?.unreadCount ?? 0);
  }, [orgId]);

  const refreshNotifications = useCallback(async () => {
    if (!orgId) return;
    const res = await fetch(buildNotificationsApiPath(new URLSearchParams({ limit: '20' })), {
      headers: buildOrgHeaders(orgId),
    });
    if (!res.ok) return;
    const payload = (await res.json()) as { data?: Notification[] };
    mergeNotifications(payload.data ?? [], { announce: false });
  }, [mergeNotifications, orgId]);

  // SSE connection via fetch (EventSource does not support custom headers)
  useEffect(() => {
    if (!orgId) return;
    if (NOTIFICATION_STREAM_DISABLED) {
      // stream 無効環境(E2E 等)では初回表示を件数取得に抑え、一覧はドロワー表示時に読む
      void refreshNotificationSummary();
      return;
    }
    void refreshNotificationSummary();
    return subscribeSharedRealtimeStream({
      orgId,
      onEvent: (event) => {
        const nextNotifications = normalizeNotificationStreamPayload(event);
        if (nextNotifications.length > 0) {
          mergeNotifications(nextNotifications, {
            announce: true,
          });
        }
      },
    });
  }, [mergeNotifications, orgId, refreshNotificationSummary]);

  useEffect(() => {
    if (!notificationDrawerOpen || notifications.length > 0) return;
    void refreshNotifications();
  }, [notificationDrawerOpen, notifications.length, refreshNotifications]);

  const unreadCount =
    notifications.length > 0 ? notifications.filter((n) => !n.is_read).length : unreadSummaryCount;

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!orgId || ids.length === 0) return;
      await fetch(NOTIFICATIONS_API_PATH, {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ ids }),
      });
      if (!mountedRef.current) return;
      setNotifications((prev) =>
        prev.map((notification) =>
          ids.includes(notification.id) ? { ...notification, is_read: true } : notification,
        ),
      );
      setUnreadSummaryCount((count) => Math.max(0, count - ids.length));
    },
    [orgId],
  );

  const markAllRead = useCallback(async () => {
    const ids = notifications.filter((n) => !n.is_read).map((n) => n.id);
    await markRead(ids);
  }, [markRead, notifications]);

  return (
    <>
      <button
        type="button"
        onClick={() => setNotificationDrawerOpen(true)}
        className={cn(
          'relative flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-accent sm:min-h-9 sm:min-w-0',
          unreadCount > 0 ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-label={`通知${unreadCount > 0 ? ` ${unreadCount}件の未読` : ''}`}
        aria-expanded={notificationDrawerOpen}
        aria-haspopup="true"
        data-testid="app-header-notifications"
      >
        <Bell className="size-4 md:hidden" aria-hidden="true" />
        <span className="hidden md:inline">通知{unreadCount > 0 ? ` ${unreadCount}` : ''}</span>
        {unreadCount > 0 && (
          <span
            className="absolute right-1 top-1 flex size-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground md:hidden"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <Sheet open={notificationDrawerOpen} onOpenChange={setNotificationDrawerOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <div className="flex items-center justify-between gap-3 pr-10">
              <div>
                <SheetTitle>通知センター</SheetTitle>
                <SheetDescription>未読 {unreadCount} 件 / 最新 20 件を表示</SheetDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshNotifications()}
                >
                  更新
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void markAllRead()}
                  disabled={unreadCount === 0}
                >
                  全て既読
                </Button>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex min-h-60 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                <BellOff className="size-8" aria-hidden="true" />
                <p>通知はありません</p>
              </div>
            ) : (
              <div className="divide-y">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`space-y-2 px-4 py-3 text-sm ${notification.is_read ? 'opacity-70' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          {notification.title ?? notification.message}
                        </p>
                        {notification.title && (
                          <p className="text-muted-foreground">{notification.message}</p>
                        )}
                      </div>
                      {!notification.is_read && (
                        <span className="mt-1 inline-block size-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{new Date(notification.created_at).toLocaleString('ja-JP')}</span>
                      {!notification.is_read && (
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => void markRead([notification.id])}
                        >
                          既読にする
                        </button>
                      )}
                      {notification.link && (
                        <Link
                          href={notification.link}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                          onClick={() => {
                            void markRead([notification.id]);
                            setNotificationDrawerOpen(false);
                          }}
                        >
                          詳細へ
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t p-4">
            <Link
              href="/notifications"
              onClick={() => setNotificationDrawerOpen(false)}
              className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
            >
              通知一覧を開く
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
