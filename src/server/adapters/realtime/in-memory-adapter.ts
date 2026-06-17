type RealtimeListener = (data: unknown) => void;

const channelListeners = new Map<string, Set<RealtimeListener>>();
const recentEvents = new Map<string, unknown[]>();
const MAX_RECENT_EVENTS = 20;
const MAX_RECENT_CHANNELS = 500;
const ORG_CHANNEL_PREFIX = String.fromCharCode(111, 114, 103, 58);
const REPLAYABLE_CHANNEL_PREFIXES = [ORG_CHANNEL_PREFIX, 'user:'] as const;

function shouldRetainRecentEvents(channel: string, listenerCount: number): boolean {
  if (listenerCount > 0) return true;
  return REPLAYABLE_CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix));
}

function enforceRecentChannelLimit(): void {
  while (recentEvents.size > MAX_RECENT_CHANNELS) {
    const evictableKey =
      recentEvents.keys().find((channel) => !channelListeners.has(channel)) ??
      recentEvents.keys().next().value;

    if (!evictableKey) return;
    recentEvents.delete(evictableKey);
  }
}

export class RealtimeAdapter {
  async broadcastStatusUpdate(channel: string, data: Record<string, unknown>): Promise<void> {
    const listeners = channelListeners.get(channel);

    if (shouldRetainRecentEvents(channel, listeners?.size ?? 0)) {
      const current = recentEvents.get(channel) ?? [];
      current.push(data);
      recentEvents.set(channel, current.slice(-MAX_RECENT_EVENTS));
      enforceRecentChannelLimit();
    }

    for (const listener of listeners ?? []) {
      listener(data);
    }
  }

  async subscribeToChannel(channel: string, callback: (data: unknown) => void): Promise<void> {
    const listeners = channelListeners.get(channel) ?? new Set<RealtimeListener>();
    listeners.add(callback);
    channelListeners.set(channel, listeners);

    for (const event of recentEvents.get(channel) ?? []) {
      callback(event);
    }
  }

  unsubscribeFromChannel(channel: string, callback: (data: unknown) => void): void {
    const listeners = channelListeners.get(channel);
    if (!listeners) return;
    listeners.delete(callback);
    if (listeners.size === 0) {
      channelListeners.delete(channel);
      recentEvents.delete(channel);
    }
  }
}

export function __resetInMemoryRealtimeStateForTests(): void {
  channelListeners.clear();
  recentEvents.clear();
}

export function __getInMemoryRealtimeStatsForTests(): {
  listenerChannelCount: number;
  recentChannelCount: number;
} {
  return {
    listenerChannelCount: channelListeners.size,
    recentChannelCount: recentEvents.size,
  };
}
