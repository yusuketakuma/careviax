type RealtimeListener = (data: unknown) => void;

const channelListeners = new Map<string, Set<RealtimeListener>>();
const recentEvents = new Map<string, unknown[]>();
const MAX_RECENT_EVENTS = 20;

export class RealtimeAdapter {
  async broadcastStatusUpdate(channel: string, data: Record<string, unknown>): Promise<void> {
    const current = recentEvents.get(channel) ?? [];
    current.push(data);
    recentEvents.set(channel, current.slice(-MAX_RECENT_EVENTS));

    for (const listener of channelListeners.get(channel) ?? []) {
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
