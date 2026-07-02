import Redis from 'ioredis';
import { parseJsonObjectOrNull } from '@/lib/db/json';
import { logger } from '@/lib/utils/logger';

type RealtimeListener = (data: unknown) => void;

const channelListeners = new Map<string, Set<RealtimeListener>>();

let pub: Redis | null = null;
let sub: Redis | null = null;
const subscribedChannels = new Set<string>();
const pendingUnsubscribes = new Map<string, Promise<void>>();

function warnRealtimeAdapterFailure({
  event,
  channel,
  operation,
  code,
  error,
}: {
  event: string;
  channel: string;
  operation: string;
  code: string;
  error: unknown;
}) {
  logger.warn(
    {
      event,
      operation,
      entityType: 'realtime_channel',
      entityId: channel,
      code,
    },
    error,
  );
}

export function parseRedisRealtimeMessage(message: string): Record<string, unknown> | null {
  return parseJsonObjectOrNull(message);
}

function getConnections(): { pub: Redis; sub: Redis } {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL environment variable is not set; RealtimeAdapter cannot connect');
  }
  if (!pub) {
    pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }
  if (!sub) {
    sub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    sub.on('message', (channel: string, message: string) => {
      const listeners = channelListeners.get(channel);
      if (!listeners) return;
      const data = parseRedisRealtimeMessage(message);
      if (!data) return;
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (err) {
          // Isolate listener failures so one bad listener does not block others.
          warnRealtimeAdapterFailure({
            event: 'realtime.listener_failed',
            channel,
            operation: 'handle_message',
            code: 'LISTENER_FAILED',
            error: err,
          });
        }
      }
    });
  }
  return { pub, sub };
}

async function subscribeRedisChannel(subscriber: Redis, channel: string): Promise<void> {
  subscribedChannels.add(channel);
  try {
    await subscriber.subscribe(channel);
  } catch (err) {
    subscribedChannels.delete(channel);
    throw err;
  }
}

export class RealtimeAdapter {
  async broadcastStatusUpdate(channel: string, data: Record<string, unknown>): Promise<void> {
    const { pub: publisher } = getConnections();
    await publisher.publish(channel, JSON.stringify(data));
  }

  async subscribeToChannel(channel: string, callback: (data: unknown) => void): Promise<void> {
    const { sub: subscriber } = getConnections();

    const listeners = channelListeners.get(channel) ?? new Set<RealtimeListener>();
    listeners.add(callback);
    channelListeners.set(channel, listeners);

    const pendingUnsubscribe = pendingUnsubscribes.get(channel);
    if (pendingUnsubscribe) {
      await pendingUnsubscribe;
    }

    if (!subscribedChannels.has(channel)) {
      await subscribeRedisChannel(subscriber, channel);
    }
  }

  unsubscribeFromChannel(channel: string, callback: (data: unknown) => void): void {
    const listeners = channelListeners.get(channel);
    if (!listeners) return;
    listeners.delete(callback);
    if (listeners.size === 0) {
      channelListeners.delete(channel);
      if (pendingUnsubscribes.has(channel)) return;
      const subscriber = sub;
      if (!subscriber) {
        subscribedChannels.delete(channel);
        return;
      }

      const pendingUnsubscribe = (async () => {
        try {
          await subscriber.unsubscribe(channel);
        } catch (err) {
          warnRealtimeAdapterFailure({
            event: 'realtime.unsubscribe_failed',
            channel,
            operation: 'unsubscribe',
            code: 'UNSUBSCRIBE_FAILED',
            error: err,
          });
          subscribedChannels.delete(channel);
          return;
        }

        subscribedChannels.delete(channel);
        if (!channelListeners.has(channel)) return;

        try {
          await subscribeRedisChannel(subscriber, channel);
        } catch (err) {
          warnRealtimeAdapterFailure({
            event: 'realtime.resubscribe_race_failed',
            channel,
            operation: 'resubscribe_after_unsubscribe_race',
            code: 'RESUBSCRIBE_RACE_FAILED',
            error: err,
          });
        }
      })().finally(() => {
        pendingUnsubscribes.delete(channel);
      });

      pendingUnsubscribes.set(channel, pendingUnsubscribe);
    }
  }
}
