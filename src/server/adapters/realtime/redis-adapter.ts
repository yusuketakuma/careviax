import Redis from 'ioredis';

type RealtimeListener = (data: unknown) => void;

const channelListeners = new Map<string, Set<RealtimeListener>>();

let pub: Redis | null = null;
let sub: Redis | null = null;
const subscribedChannels = new Set<string>();

function getConnections(): { pub: Redis; sub: Redis } {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      'REDIS_URL environment variable is not set; RealtimeAdapter cannot connect',
    );
  }
  if (!pub) {
    pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }
  if (!sub) {
    sub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    sub.on('message', (channel: string, message: string) => {
      const listeners = channelListeners.get(channel);
      if (!listeners) return;
      try {
        const data = JSON.parse(message);
        for (const listener of listeners) {
          listener(data);
        }
      } catch {
        // Ignore malformed messages
      }
    });
  }
  return { pub, sub };
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

    if (!subscribedChannels.has(channel)) {
      subscribedChannels.add(channel);
      await subscriber.subscribe(channel);
    }
  }

  unsubscribeFromChannel(channel: string, callback: (data: unknown) => void): void {
    const listeners = channelListeners.get(channel);
    if (!listeners) return;
    listeners.delete(callback);
    if (listeners.size === 0) {
      channelListeners.delete(channel);
      subscribedChannels.delete(channel);
      sub?.unsubscribe(channel).catch(() => {});
    }
  }
}
