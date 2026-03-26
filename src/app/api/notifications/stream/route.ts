import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const orgId = req.headers.get('x-org-id');
  if (!orgId) {
    return new Response('Missing x-org-id', { status: 400 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();
  let lastCheckAt = new Date();

  const POLL_INTERVAL_MS = 5_000;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(': keepalive\n\n'));

      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

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

      req.signal.addEventListener('abort', () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        controller.close();
      });
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
