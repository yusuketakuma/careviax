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
import {
  getBrowserNotificationPreference,
  isBrowserNotificationSupported,
  showBrowserNotification,
} from '@/lib/browser-notifications';

type Notification = {
  id: string;
  type: string;
  title?: string;
  message: string;
  link?: string | null;
  created_at: string;
  is_read: boolean;
};

const NOTIFICATION_STREAM_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM === '1';

export function NotificationBell() {
  const orgId = useOrgId();
  const { notificationDrawerOpen, setNotificationDrawerOpen } = useUIStore();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const abortRef = useRef<AbortController | null>(null);
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
      await showBrowserNotification({
        title: item.title ?? 'CareViaX 通知',
        body: item.message,
        tag: item.id,
        url: item.link,
      });
    }
  }, []);

  const mergeNotifications = useCallback((items: Notification[], options?: { announce?: boolean }) => {
    if (!mountedRef.current) return;
    const unseenItems = items.filter((item) => !seenIdsRef.current.has(item.id));
    for (const item of items) {
      seenIdsRef.current.add(item.id);
    }
    if (options?.announce) {
      void maybeShowBrowserNotifications(unseenItems.filter((item) => !item.is_read));
    }

    setNotifications((prev) => {
      const merged = [...items, ...prev];
      const unique = merged.filter(
        (notification, index, all) =>
          all.findIndex((candidate) => candidate.id === notification.id) === index
      );
      unique.sort(
        (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      );
      return unique.slice(0, 50);
    });
  }, [maybeShowBrowserNotifications]);

  const refreshNotifications = useCallback(async () => {
    if (!orgId) return;
    const res = await fetch('/api/notifications?limit=20', {
      headers: { 'x-org-id': orgId },
    });
    if (!res.ok) return;
    const payload = (await res.json()) as { data?: Notification[] };
    mergeNotifications(payload.data ?? [], { announce: false });
  }, [mergeNotifications, orgId]);

  // SSE connection via fetch (EventSource does not support custom headers)
  useEffect(() => {
    if (!orgId || NOTIFICATION_STREAM_DISABLED) return;
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        await refreshNotifications();
        const res = await fetch('/api/notifications/stream', {
          headers: { 'x-org-id': orgId },
          signal: controller.signal,
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';
          for (const chunk of lines) {
            if (chunk.startsWith('data: ')) {
              const json = chunk.slice(6);
              try {
                mergeNotifications(JSON.parse(json) as Notification[], {
                  announce: true,
                });
              } catch {
                // Ignore malformed JSON chunks
              }
            }
          }
        }
      } catch {
        // Connection closed or aborted — expected on unmount
      }
    })();

    return () => controller.abort();
  }, [mergeNotifications, orgId, refreshNotifications]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!orgId || ids.length === 0) return;
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ ids }),
      });
      if (!mountedRef.current) return;
      setNotifications((prev) =>
        prev.map((notification) =>
          ids.includes(notification.id) ? { ...notification, is_read: true } : notification
        )
      );
    },
    [orgId]
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
        className="relative rounded-md p-2 hover:bg-accent"
        aria-label={`通知${unreadCount > 0 ? ` ${unreadCount}件の未読` : ''}`}
        aria-expanded={notificationDrawerOpen}
        aria-haspopup="true"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex size-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground"
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
                <SheetDescription>
                  未読 {unreadCount} 件 / 最新 20 件を表示
                </SheetDescription>
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
