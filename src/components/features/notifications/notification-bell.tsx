'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { z, type ZodType } from 'zod';
import { Bell, BellOff, ExternalLink } from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useUIStore } from '@/lib/stores/ui-store';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Loading } from '@/components/ui/loading';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  getBrowserNotificationPreference,
  isBrowserNotificationSupported,
  showBrowserNotification,
} from '@/lib/browser-notifications';
import { NOTIFICATIONS_API_PATH, buildNotificationsApiPath } from '@/lib/notifications/api-paths';
import {
  notificationSummaryResponseSchema,
  notificationsResponseSchema,
  type NotificationItem,
  type NotificationsResponse,
  type NotificationSummaryResponse,
} from '@/lib/notifications/response-schema';
import { normalizeNotificationStreamPayload } from '@/lib/notifications/stream-payload';
import { subscribeSharedRealtimeStream } from '@/lib/realtime/shared-event-stream';

type Notification = NotificationItem;
type RefreshStatus = 'idle' | 'loading' | 'ready' | 'error';
type FailedReadMutation = { all: true } | { all: false; ids: string[] };
type NotificationRefreshResult<T> = { ok: true; data: T } | { ok: false };

const NOTIFICATION_STREAM_DISABLED = process.env.NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM === '1';
const NOTIFICATION_PAGE_LIMIT = 20;
function notificationReadAcknowledgementSchema(expectedMessage: string) {
  return z
    .object({
      data: z
        .object({
          message: z.literal(expectedMessage),
        })
        .strict(),
    })
    .strict();
}
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

async function readNotificationRefreshJson<T>(
  response: Promise<Response>,
  schema: ZodType<T>,
): Promise<NotificationRefreshResult<T>> {
  try {
    const res = await response;
    if (!res.ok) return { ok: false };
    return {
      ok: true,
      data: await readApiJson<T>(res, {
        fallbackMessage: '通知の取得に失敗しました',
        schema,
      }),
    };
  } catch {
    return { ok: false };
  }
}

function getUnreadSummaryCount(payload: NotificationSummaryResponse): number {
  return payload.data.unreadCount;
}

function getNotificationList(payload: NotificationsResponse): Notification[] {
  return payload.data;
}

export function NotificationBell() {
  const orgId = useOrgId();

  return <NotificationBellContent key={orgId ?? 'no-org'} orgId={orgId} />;
}

function NotificationBellContent({ orgId }: { orgId: ReturnType<typeof useOrgId> }) {
  const { notificationDrawerOpen, setNotificationDrawerOpen } = useUIStore();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadSummaryCount, setUnreadSummaryCount] = useState<number | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<RefreshStatus>('idle');
  const [listStatus, setListStatus] = useState<RefreshStatus>('idle');
  const [listHasMore, setListHasMore] = useState(false);
  const [listNextCursor, setListNextCursor] = useState<string | null>(null);
  const [failedListCursor, setFailedListCursor] = useState<string | null>(null);
  const [readMutationPending, setReadMutationPending] = useState(false);
  const [readMutationError, setReadMutationError] = useState(false);
  const [failedReadMutation, setFailedReadMutation] = useState<FailedReadMutation | null>(null);
  const seenIdsRef = useRef(new Set<string>());
  const notificationsRef = useRef<Notification[]>([]);
  const summaryRequestIdRef = useRef(0);
  const listRequestIdRef = useRef(0);
  const readMutationPendingRef = useRef(false);
  const notificationRevisionRef = useRef(new Map<string, number>());
  const consumedListCursorsRef = useRef(new Set<string>());
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    notificationsRef.current = notifications;
    const visibleIds = new Set(notifications.map((notification) => notification.id));
    for (const id of notificationRevisionRef.current.keys()) {
      if (!visibleIds.has(id)) notificationRevisionRef.current.delete(id);
    }
  }, [notifications]);

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
      // raw title/message/link は helper 境界で破棄し、詳細はアプリ内で開く。
      await showBrowserNotification({
        tag: item.id,
        type: item.type,
      });
    }
  }, []);

  const mergeNotifications = useCallback(
    (items: Notification[], options?: { announce?: boolean }) => {
      if (!mountedRef.current) return;
      const unseenItems = items.filter((item) => !seenIdsRef.current.has(item.id));
      for (const item of items) {
        seenIdsRef.current.add(item.id);
        notificationRevisionRef.current.set(
          item.id,
          (notificationRevisionRef.current.get(item.id) ?? 0) + 1,
        );
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
            new Date(right.created_at).getTime() - new Date(left.created_at).getTime() ||
            right.id.localeCompare(left.id),
        );
        pruneSeenNotificationIds(
          seenIdsRef.current,
          unique.map((notification) => notification.id),
        );
        return unique;
      });
    },
    [maybeShowBrowserNotifications],
  );

  const refreshNotificationSummary = useCallback(async () => {
    if (!orgId) return;
    const requestId = ++summaryRequestIdRef.current;
    await Promise.resolve();
    if (!mountedRef.current || requestId !== summaryRequestIdRef.current) return;
    setSummaryStatus('loading');
    const result = await readNotificationRefreshJson<NotificationSummaryResponse>(
      fetch(buildNotificationsApiPath(new URLSearchParams({ summary: '1' })), {
        headers: buildOrgHeaders(orgId),
      }),
      notificationSummaryResponseSchema,
    );
    if (!mountedRef.current || requestId !== summaryRequestIdRef.current) return;
    if (!result.ok) {
      setSummaryStatus('error');
      return;
    }
    const unreadCount = getUnreadSummaryCount(result.data);
    setUnreadSummaryCount(unreadCount);
    setSummaryStatus('ready');
  }, [orgId]);

  const refreshNotifications = useCallback(
    async (cursor: string | null = null) => {
      if (!orgId) return;
      const requestId = ++listRequestIdRef.current;
      const revisionSnapshot =
        cursor === null ? new Map(notificationRevisionRef.current) : undefined;
      const nextConsumedCursors =
        cursor === null ? new Set<string>() : new Set<string>(consumedListCursorsRef.current);
      if (cursor !== null) {
        if (nextConsumedCursors.has(cursor)) {
          setFailedListCursor(cursor);
          setListStatus('error');
          return;
        }
        nextConsumedCursors.add(cursor);
      }
      await Promise.resolve();
      if (!mountedRef.current || requestId !== listRequestIdRef.current) return;
      setListStatus('loading');
      setFailedListCursor(null);
      const params = new URLSearchParams({ limit: String(NOTIFICATION_PAGE_LIMIT) });
      if (cursor) params.set('cursor', cursor);
      const result = await readNotificationRefreshJson<NotificationsResponse>(
        fetch(buildNotificationsApiPath(params), {
          headers: buildOrgHeaders(orgId),
        }),
        notificationsResponseSchema,
      );
      if (!mountedRef.current || requestId !== listRequestIdRef.current) return;
      if (!result.ok) {
        setFailedListCursor(cursor);
        setListStatus('error');
        return;
      }
      const nextCursor = result.data.meta.next_cursor;
      if (result.data.meta.has_more && nextCursor !== null && nextConsumedCursors.has(nextCursor)) {
        setFailedListCursor(cursor);
        setListStatus('error');
        return;
      }

      const notificationList = getNotificationList(result.data);
      consumedListCursorsRef.current = nextConsumedCursors;
      if (cursor === null && revisionSnapshot) {
        const changedSinceRequest = new Set<string>();
        for (const [id, revision] of notificationRevisionRef.current) {
          if (revisionSnapshot.get(id) !== revision) changedSinceRequest.add(id);
        }
        for (const item of notificationList) {
          seenIdsRef.current.add(item.id);
          notificationRevisionRef.current.set(
            item.id,
            (notificationRevisionRef.current.get(item.id) ?? 0) + 1,
          );
        }
        setNotifications((current) => {
          const uniqueById = new Map(notificationList.map((item) => [item.id, item]));
          for (const item of current) {
            if (changedSinceRequest.has(item.id)) uniqueById.set(item.id, item);
          }
          const next = [...uniqueById.values()].sort(
            (left, right) =>
              new Date(right.created_at).getTime() - new Date(left.created_at).getTime() ||
              right.id.localeCompare(left.id),
          );
          pruneSeenNotificationIds(
            seenIdsRef.current,
            next.map((item) => item.id),
          );
          return next;
        });
      } else {
        mergeNotifications(notificationList, { announce: false });
      }
      setListHasMore(result.data.meta.has_more);
      setListNextCursor(nextCursor);
      setListStatus('ready');
    },
    [mergeNotifications, orgId],
  );

  const refreshAllNotifications = useCallback(async () => {
    await Promise.all([refreshNotificationSummary(), refreshNotifications()]);
  }, [refreshNotificationSummary, refreshNotifications]);

  const retryNotificationList = useCallback(() => {
    void refreshNotifications(failedListCursor);
  }, [failedListCursor, refreshNotifications]);

  const loadMoreNotifications = useCallback(() => {
    if (!listHasMore || !listNextCursor || listStatus === 'loading') return;
    void refreshNotifications(listNextCursor);
  }, [listHasMore, listNextCursor, listStatus, refreshNotifications]);

  const refreshSummaryAfterRealtimeEvent = useCallback(() => {
    void refreshNotificationSummary();
  }, [refreshNotificationSummary]);

  const runReadMutation = useCallback(
    async (mutation: FailedReadMutation) => {
      if (!orgId || readMutationPendingRef.current) return;
      const ids = mutation.all
        ? notificationsRef.current.filter((item) => !item.is_read).map((item) => item.id)
        : Array.from(new Set(mutation.ids));
      if (!mutation.all && ids.length === 0) return;

      const optimisticallyReadIds = new Set(ids);
      const optimisticRevisions = new Map<string, number>();
      for (const id of optimisticallyReadIds) {
        const revision = (notificationRevisionRef.current.get(id) ?? 0) + 1;
        notificationRevisionRef.current.set(id, revision);
        optimisticRevisions.set(id, revision);
      }
      readMutationPendingRef.current = true;
      setReadMutationPending(true);
      setReadMutationError(false);
      setFailedReadMutation(null);
      setNotifications((current) =>
        current.map((notification) =>
          optimisticallyReadIds.has(notification.id)
            ? { ...notification, is_read: true }
            : notification,
        ),
      );

      try {
        const response = await fetch(NOTIFICATIONS_API_PATH, {
          method: 'PATCH',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify(mutation.all ? { all: true } : { ids }),
        });
        if (!response.ok) throw new Error('notification read mutation rejected');
        await readApiJson(response, {
          fallbackMessage: '通知の既読状態を更新できませんでした',
          schema: notificationReadAcknowledgementSchema(
            mutation.all ? '全て既読にしました' : `${ids.length}件を既読にしました`,
          ),
        });
        if (!mountedRef.current) return;
        setReadMutationError(false);
        setFailedReadMutation(null);
        await refreshAllNotifications();
      } catch {
        if (!mountedRef.current) return;
        setNotifications((current) =>
          current.map((notification) =>
            optimisticallyReadIds.has(notification.id) &&
            notificationRevisionRef.current.get(notification.id) ===
              optimisticRevisions.get(notification.id)
              ? { ...notification, is_read: false }
              : notification,
          ),
        );
        setReadMutationError(true);
        setFailedReadMutation(mutation.all ? { all: true } : { all: false, ids });
        void refreshNotificationSummary();
      } finally {
        readMutationPendingRef.current = false;
        if (mountedRef.current) setReadMutationPending(false);
      }
    },
    [orgId, refreshAllNotifications, refreshNotificationSummary],
  );

  const markRead = useCallback(
    async (ids: string[]) => {
      await runReadMutation({ all: false, ids });
    },
    [runReadMutation],
  );

  const markAllRead = useCallback(async () => {
    await runReadMutation({ all: true });
  }, [runReadMutation]);

  const retryReadMutation = useCallback(() => {
    if (failedReadMutation) void runReadMutation(failedReadMutation);
  }, [failedReadMutation, runReadMutation]);

  // SSE connection via fetch (EventSource does not support custom headers)
  useEffect(() => {
    if (!orgId) return;
    const summaryTimer = window.setTimeout(() => {
      void refreshNotificationSummary();
    }, 0);
    if (NOTIFICATION_STREAM_DISABLED) {
      // stream 無効環境(E2E 等)では初回表示を件数取得に抑え、一覧はドロワー表示時に読む
      return () => window.clearTimeout(summaryTimer);
    }
    const unsubscribe = subscribeSharedRealtimeStream({
      orgId,
      onEvent: (event) => {
        const nextNotifications = normalizeNotificationStreamPayload(event);
        if (nextNotifications.length > 0) {
          mergeNotifications(nextNotifications, {
            announce: true,
          });
          refreshSummaryAfterRealtimeEvent();
        }
      },
    });
    return () => {
      window.clearTimeout(summaryTimer);
      unsubscribe();
    };
  }, [mergeNotifications, orgId, refreshNotificationSummary, refreshSummaryAfterRealtimeEvent]);

  useEffect(() => {
    if (!notificationDrawerOpen || listStatus !== 'idle') return;
    const listTimer = window.setTimeout(() => {
      void refreshNotifications();
    }, 0);
    return () => window.clearTimeout(listTimer);
  }, [notificationDrawerOpen, listStatus, refreshNotifications]);

  const unreadCount = summaryStatus === 'ready' ? unreadSummaryCount : null;
  const listIsPartial = listHasMore || listStatus === 'error';
  const unreadStatusLabel =
    summaryStatus === 'ready'
      ? `未読 ${unreadSummaryCount ?? 0} 件`
      : summaryStatus === 'loading'
        ? unreadSummaryCount === null
          ? '未読件数を読み込み中'
          : `未読件数を更新中（前回 ${unreadSummaryCount} 件）`
        : summaryStatus === 'error'
          ? unreadSummaryCount === null
            ? '未読件数は取得できません'
            : `未読件数は取得できません（前回 ${unreadSummaryCount} 件）`
          : '未読件数を準備中';
  const triggerAriaLabel =
    summaryStatus === 'ready'
      ? `通知${unreadCount !== null && unreadCount > 0 ? ` ${unreadCount}件の未読` : ''}`
      : `通知 ${unreadStatusLabel}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setNotificationDrawerOpen(true)}
        className={cn(
          'relative flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-accent',
          unreadCount !== null && unreadCount > 0 ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-label={triggerAriaLabel}
        aria-expanded={notificationDrawerOpen}
        aria-haspopup="true"
        data-testid="app-header-notifications"
      >
        <Bell className="size-4 md:hidden" aria-hidden="true" />
        <span className="hidden md:inline">
          通知{unreadCount !== null && unreadCount > 0 ? ` ${unreadCount}` : ''}
        </span>
        {unreadCount !== null && unreadCount > 0 && (
          <span
            className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground md:hidden"
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
                <SheetDescription aria-live="polite" aria-atomic="true">
                  {unreadStatusLabel}
                  {` / 読込済み ${notifications.length} 件${listIsPartial ? '（一部表示）' : ''}`}
                </SheetDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshAllNotifications()}
                  disabled={listStatus === 'loading' || summaryStatus === 'loading'}
                >
                  更新
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void markAllRead()}
                  disabled={
                    summaryStatus !== 'ready' ||
                    unreadCount === null ||
                    unreadCount === 0 ||
                    readMutationPending
                  }
                >
                  未読通知をすべて既読
                </Button>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {summaryStatus === 'error' && (
              <ErrorState
                title="未読件数を取得できません"
                cause="通知の集計に失敗しました。"
                nextAction="通信状態を確認して再試行してください。"
                onRetry={() => void refreshNotificationSummary()}
                retryDisabled={false}
                headingLevel={3}
                className="m-4 py-5"
              />
            )}

            {readMutationError && (
              <ErrorState
                title="既読状態を更新できません"
                cause="通知の既読状態を保存できませんでした。"
                nextAction="通信状態を確認して再試行してください。"
                onRetry={retryReadMutation}
                retryDisabled={readMutationPending}
                headingLevel={3}
                live="assertive"
                className="m-4 py-5"
              />
            )}

            {listStatus === 'error' && (
              <ErrorState
                title="通知を取得できません"
                cause="通知一覧の取得に失敗しました。"
                nextAction="通信状態を確認して再試行してください。"
                onRetry={retryNotificationList}
                retryDisabled={false}
                headingLevel={3}
                className="m-4 py-5"
              />
            )}

            {(listStatus === 'idle' || listStatus === 'loading') && notifications.length === 0 ? (
              <Loading label="通知一覧を読み込み中" />
            ) : listStatus === 'ready' && notifications.length === 0 ? (
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
                        <span
                          className="mt-1 inline-block size-2 rounded-full bg-primary"
                          aria-label="未読"
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{new Date(notification.created_at).toLocaleString('ja-JP')}</span>
                      {!notification.is_read && (
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center text-primary hover:underline"
                          onClick={() => void markRead([notification.id])}
                          disabled={readMutationPending}
                        >
                          既読にする
                        </button>
                      )}
                      {notification.link && (
                        <Link
                          href={notification.link}
                          className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline"
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

            {listStatus !== 'error' && listHasMore && listNextCursor && (
              <div className="border-t p-4 text-center">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:min-h-11"
                  onClick={loadMoreNotifications}
                  disabled={listStatus === 'loading'}
                >
                  {listStatus === 'loading' ? '通知を読み込み中' : 'さらに読み込む'}
                </Button>
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
