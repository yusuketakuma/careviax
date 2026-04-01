import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { acquireSseConnection, releaseSseConnection } from '@/lib/api/rate-limit';
import { getRealtimeAdapter } from '@/server/adapters/realtime';

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
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(': keepalive\n\n'));

      let stopped = false;
      let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let realtimeActive = false;
      let lastCheckAt = new Date();

      const teardown = () => {
        if (stopped) return;
        stopped = true;
        if (keepaliveTimer) clearTimeout(keepaliveTimer);
        if (pollTimer) clearTimeout(pollTimer);
        clearTimeout(lifetime);
        // Unsubscribe realtime listeners to prevent memory leaks
        if (adapter && realtimeActive) {
          adapter.unsubscribeFromChannel(`org:${orgId}`, listener);
          adapter.unsubscribeFromChannel(`user:${userId}`, listener);
        }
        releaseSseConnection(userId);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      const lifetime = setTimeout(teardown, MAX_STREAM_DURATION_MS);

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
        keepaliveTimer = setTimeout(heartbeat, KEEPALIVE_INTERVAL_MS);
      };
      keepaliveTimer = setTimeout(heartbeat, KEEPALIVE_INTERVAL_MS);

      // Try realtime adapter subscription
      let adapter: ReturnType<typeof getRealtimeAdapter> | null = null;
      const listener = (data: unknown) => sendEvent(data);

      try {
        adapter = getRealtimeAdapter();
        await Promise.all([
          adapter.subscribeToChannel(`org:${orgId}`, listener),
          adapter.subscribeToChannel(`user:${userId}`, listener),
        ]);
        realtimeActive = true;
      } catch {
        realtimeActive = false;
      }

      // Poll unread notifications regardless of adapter availability.
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
          pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);

      req.signal.addEventListener('abort', teardown);
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
