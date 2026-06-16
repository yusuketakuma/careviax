import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { acquireSseConnection, releaseSseConnection } from '@/lib/api/rate-limit';
import { getRealtimeAdapter } from '@/server/adapters/realtime';
import { sanitizeOrgRealtimeEvent } from '@/server/services/org-realtime';
import { scheduleSseTimer } from './sse-timer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KEEPALIVE_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_STREAM_DURATION_MS = 5 * 60_000;
export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;

  const { orgId, userId } = authResult.ctx;

  const sseResult = acquireSseConnection(userId);
  if (!sseResult.allowed) {
    return new Response(
      JSON.stringify({ code: 'SSE_CONNECTION_LIMIT', message: '同時接続数の上限に達しました' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();
  let teardownStream: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(': keepalive\n\n'));

      let stopped = false;
      let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let lastCheckAt = new Date();
      let adapter: ReturnType<typeof getRealtimeAdapter> | null = null;
      const subscribedChannels = new Map<string, (data: unknown) => void>();
      const orgChannel = `org:${orgId}`;
      const userChannel = `user:${userId}`;
      const orgListener = (data: unknown) => sendEvent(sanitizeOrgRealtimeEvent(data));
      const userListener = (data: unknown) => sendEvent(data);
      let abortHandler: (() => void) | null = null;

      const teardown = () => {
        if (stopped) return;
        stopped = true;
        if (keepaliveTimer) clearTimeout(keepaliveTimer);
        if (pollTimer) clearTimeout(pollTimer);
        clearTimeout(lifetime);
        if (abortHandler) req.signal.removeEventListener('abort', abortHandler);
        // Unsubscribe realtime listeners to prevent memory leaks
        if (adapter) {
          for (const [channel, listener] of subscribedChannels) {
            adapter.unsubscribeFromChannel(channel, listener);
          }
          subscribedChannels.clear();
        }
        releaseSseConnection(userId);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };
      teardownStream = teardown;

      const lifetime = scheduleSseTimer(teardown, MAX_STREAM_DURATION_MS);
      abortHandler = teardown;
      req.signal.addEventListener('abort', abortHandler, { once: true });
      if (req.signal.aborted) {
        teardown();
        return;
      }

      const sendEvent = (data: unknown) => {
        if (stopped) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          teardown();
        }
      };

      // Keepalive heartbeat
      const heartbeat = () => {
        if (stopped) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          teardown();
          return;
        }
        keepaliveTimer = scheduleSseTimer(heartbeat, KEEPALIVE_INTERVAL_MS);
      };
      keepaliveTimer = scheduleSseTimer(heartbeat, KEEPALIVE_INTERVAL_MS);

      let userChannelSubscribed = false;

      // Try realtime adapter subscription
      try {
        adapter = getRealtimeAdapter();
        const subscribeToTrackedChannel = async (
          channel: string,
          listener: (data: unknown) => void,
        ) => {
          subscribedChannels.set(channel, listener);
          try {
            await adapter?.subscribeToChannel(channel, listener);
          } catch (error) {
            adapter?.unsubscribeFromChannel(channel, listener);
            subscribedChannels.delete(channel);
            throw error;
          }
          if (stopped) {
            adapter?.unsubscribeFromChannel(channel, listener);
            subscribedChannels.delete(channel);
          }
        };
        const subscriptionResults = await Promise.allSettled([
          subscribeToTrackedChannel(orgChannel, orgListener),
          subscribeToTrackedChannel(userChannel, userListener),
        ]);
        userChannelSubscribed = subscriptionResults[1]?.status === 'fulfilled';
      } catch {
        // Fall back to polling when the realtime adapter cannot be created.
      }
      if (stopped) return;

      // Poll unread notifications only when the user-channel subscription is unavailable.
      const poll = async () => {
        if (stopped) return;
        const windowEnd = new Date();
        try {
          const notifications = await prisma.notification.findMany({
            where: {
              org_id: orgId,
              user_id: userId,
              is_read: false,
              created_at: {
                gt: lastCheckAt,
                lte: windowEnd,
              },
            },
            orderBy: { created_at: 'desc' },
            take: 10,
          });

          lastCheckAt = windowEnd;

          if (notifications.length > 0) {
            sendEvent(notifications);
          }
        } catch {
          // Swallow DB errors to keep stream alive
        }
        if (!stopped) {
          pollTimer = scheduleSseTimer(poll, POLL_INTERVAL_MS);
        }
      };

      if (!userChannelSubscribed) {
        pollTimer = scheduleSseTimer(poll, POLL_INTERVAL_MS);
      }
    },
    cancel() {
      teardownStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
