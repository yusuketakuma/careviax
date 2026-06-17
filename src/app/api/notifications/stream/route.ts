import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { acquireSseConnection, releaseSseConnection } from '@/lib/api/rate-limit';
import { getRealtimeAdapter } from '@/server/adapters/realtime';
import { sanitizeOrgRealtimeEvent } from '@/server/services/org-realtime';
import {
  buildCollaborationRoomName,
  canAccessCollaborationEntity,
  collaborationEntityRefSchema,
  type CollaborationEntityType,
} from '@/server/services/collaboration-access';
import { scheduleSseTimer } from './sse-timer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KEEPALIVE_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const SUBSCRIBED_SAFETY_POLL_INTERVAL_MS = 60_000;
const MAX_STREAM_DURATION_MS = 5 * 60_000;
const MAX_PRESENCE_STREAM_ROOMS = 8;

type AuthContext = Extract<Awaited<ReturnType<typeof requireAuthContext>>, { ctx: unknown }>['ctx'];

type PresenceStreamTarget = {
  entityType: CollaborationEntityType;
  entityId: string;
  channel: string;
};

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readPresenceStreamTarget(
  raw: string,
): { entity_type: CollaborationEntityType; entity_id: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [entityType, entityId] = parsed;
  const result = collaborationEntityRefSchema.safeParse({
    entity_type: entityType,
    entity_id: entityId,
  });
  return result.success ? result.data : null;
}

async function resolvePresenceStreamTargets(
  req: NextRequest,
  ctx: AuthContext,
): Promise<PresenceStreamTarget[] | Response> {
  const rawTargets = req.nextUrl.searchParams.getAll('presence');
  if (rawTargets.length === 0) return [];
  if (rawTargets.length > MAX_PRESENCE_STREAM_ROOMS) {
    return jsonError(400, 'TOO_MANY_PRESENCE_STREAM_ROOMS', 'プレゼンス購読数の上限を超えています');
  }

  const dedupedTargets = new Map<
    string,
    { entity_type: CollaborationEntityType; entity_id: string }
  >();
  for (const rawTarget of rawTargets) {
    const target = readPresenceStreamTarget(rawTarget);
    if (!target) {
      return jsonError(400, 'INVALID_PRESENCE_STREAM_ROOM', 'プレゼンス購読指定が不正です');
    }
    dedupedTargets.set(`${target.entity_type}\u0000${target.entity_id}`, target);
  }

  const targets: PresenceStreamTarget[] = [];
  for (const target of dedupedTargets.values()) {
    const canAccessEntity = await canAccessCollaborationEntity(
      ctx,
      target.entity_type,
      target.entity_id,
    );
    if (!canAccessEntity) {
      return jsonError(404, 'PRESENCE_STREAM_ROOM_NOT_FOUND', 'プレゼンス対象が見つかりません');
    }

    const room = buildCollaborationRoomName({
      orgId: ctx.orgId,
      entityType: target.entity_type,
      entityId: target.entity_id,
    });
    targets.push({
      entityType: target.entity_type,
      entityId: target.entity_id,
      channel: `presence:${room}`,
    });
  }

  return targets;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sanitizePresenceRealtimeEvent(
  data: unknown,
  target: PresenceStreamTarget,
): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const event = data as Record<string, unknown>;
  if (event.type !== 'presence_update') return null;
  if (event.entity_type !== target.entityType || event.entity_id !== target.entityId) return null;

  const userId = readString(event.user_id);
  const displayName = readString(event.display_name);
  const updatedAt = readString(event.updated_at);
  let activeField: string | null;
  if (event.active_field == null) {
    activeField = null;
  } else {
    activeField = readString(event.active_field);
    if (activeField == null) return null;
  }
  if (!userId || !displayName || !updatedAt) return null;

  return {
    type: 'presence_update',
    entity_type: target.entityType,
    entity_id: target.entityId,
    user_id: userId,
    display_name: displayName,
    active_field: activeField,
    updated_at: updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;

  const { orgId, userId } = authResult.ctx;
  const presenceTargets = await resolvePresenceStreamTargets(req, authResult.ctx);
  if (presenceTargets instanceof Response) return presenceTargets;

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
      const presenceChannelListeners = presenceTargets.map((target) => ({
        channel: target.channel,
        listener: (data: unknown) => {
          const event = sanitizePresenceRealtimeEvent(data, target);
          if (event) sendEvent(event);
        },
      }));
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
          ...presenceChannelListeners.map(({ channel, listener }) =>
            subscribeToTrackedChannel(channel, listener),
          ),
        ]);
        userChannelSubscribed = subscriptionResults[1]?.status === 'fulfilled';
      } catch {
        // Fall back to polling when the realtime adapter cannot be created.
      }
      if (stopped) return;

      // Keep a low-frequency DB safety poll even when the user channel is subscribed.
      // Some legacy jobs still create notifications directly and cannot publish realtime payloads.
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
          pollTimer = scheduleSseTimer(
            poll,
            userChannelSubscribed ? SUBSCRIBED_SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
          );
        }
      };

      pollTimer = scheduleSseTimer(
        poll,
        userChannelSubscribed ? SUBSCRIBED_SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
      );
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
