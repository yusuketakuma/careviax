import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { acquireSseConnection, releaseSseConnection } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;

  const { orgId, userId } = authResult.ctx;

  // Gate the number of concurrent SSE connections per user to prevent
  // connection storms (e.g., many open tabs or a runaway client).
  const sseResult = acquireSseConnection(userId);
  if (!sseResult.allowed) {
    return new Response(
      JSON.stringify({ code: 'SSE_CONNECTION_LIMIT', message: '同時接続数の上限に達しました' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  let lastCheckAt = new Date();

  const POLL_INTERVAL_MS = 5_000;
  // Fix 4: Hard ceiling on stream lifetime to reclaim server resources.
  const MAX_STREAM_DURATION_MS = 5 * 60_000; // 5 minutes

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(': keepalive\n\n'));

      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

      const teardown = () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        clearTimeout(lifetime);
        releaseSseConnection(userId);
        controller.close();
      };

      // Safety valve: close stream after MAX_STREAM_DURATION_MS regardless of client state
      const lifetime = setTimeout(teardown, MAX_STREAM_DURATION_MS);

      const poll = async () => {
        if (stopped) return;
        try {
          const notifications = await prisma.notification.findMany({
            where: {
              org_id: orgId,
              user_id: userId,
              is_read: false,
              created_at: { gte: lastCheckAt },
            },
            orderBy: { created_at: 'desc' },
            take: 10,
          });

          lastCheckAt = new Date();

          if (notifications.length > 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(notifications)}\n\n`)
            );
          }
        } catch {
          // Swallow DB errors to keep stream alive
        }
        if (!stopped) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      timer = setTimeout(poll, POLL_INTERVAL_MS);

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
