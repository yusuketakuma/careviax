'use client';

import { normalizeRealtimeEventPayload } from '@/lib/realtime/events';
import { normalizeNotificationStreamPayload } from '@/lib/notifications/stream-payload';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { logger } from '@/lib/utils/logger';
import {
  REALTIME_READINESS_EVENT,
  hasRequiredRealtimeReadiness,
  parseRealtimeReadiness,
  type RealtimeChannel,
  type RealtimeReadiness,
} from './readiness';

type RealtimeListener = (event: unknown) => void;
type StatusListener = (connected: boolean) => void;

type StatusSubscription = {
  requiredChannels: readonly RealtimeChannel[];
  lastReady: boolean;
};

export type RealtimePresenceTarget = {
  entityType: string;
  entityId: string;
};

type SharedRealtimeStream = {
  orgId: string;
  listeners: Set<RealtimeListener>;
  statusListeners: Map<StatusListener, StatusSubscription>;
  presenceTargets: Map<string, { target: RealtimePresenceTarget; count: number }>;
  abortController: AbortController | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  presenceTargetReconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  transportConnected: boolean;
  readiness: RealtimeReadiness | null;
  stopped: boolean;
};

const PRESENCE_TARGET_RECONNECT_DEBOUNCE_MS = 150;
const DEFAULT_REQUIRED_CHANNELS = ['user'] as const satisfies readonly RealtimeChannel[];
const streams = new Map<string, SharedRealtimeStream>();

function presenceTargetKey(target: RealtimePresenceTarget) {
  return `${target.entityType}\u0000${target.entityId}`;
}

function serializePresenceTarget(target: RealtimePresenceTarget) {
  return JSON.stringify([target.entityType, target.entityId]);
}

function buildStreamUrl(stream: SharedRealtimeStream) {
  if (stream.presenceTargets.size === 0) return '/api/notifications/stream';

  const params = new URLSearchParams();
  const targets = [...stream.presenceTargets.values()]
    .map(({ target }) => target)
    .sort((a, b) => presenceTargetKey(a).localeCompare(presenceTargetKey(b)));
  for (const target of targets) {
    params.append('presence', serializePresenceTarget(target));
  }
  return `/api/notifications/stream?${params.toString()}`;
}

function clearReconnectTimer(stream: SharedRealtimeStream) {
  if (!stream.reconnectTimer) return;
  clearTimeout(stream.reconnectTimer);
  stream.reconnectTimer = null;
}

function clearPresenceTargetReconnectTimer(stream: SharedRealtimeStream) {
  if (!stream.presenceTargetReconnectTimer) return;
  clearTimeout(stream.presenceTargetReconnectTimer);
  stream.presenceTargetReconnectTimer = null;
}

function schedulePresenceTargetReconnect(stream: SharedRealtimeStream) {
  if (!stream.abortController || stream.presenceTargetReconnectTimer) return;

  stream.presenceTargetReconnectTimer = setTimeout(() => {
    stream.presenceTargetReconnectTimer = null;
    if (stream.stopped || !stream.abortController) return;
    stream.abortController.abort();
  }, PRESENCE_TARGET_RECONNECT_DEBOUNCE_MS);
}

function logRealtimeListenerError(
  stream: SharedRealtimeStream,
  operation: 'notify_event_listener' | 'notify_status_listener',
  error: unknown,
) {
  logger.error(
    {
      event: 'realtime.listener_failed',
      route: '/api/notifications/stream',
      method: 'GET',
      orgId: stream.orgId,
      operation,
    },
    error,
  );
}

function isSubscriptionReady(stream: SharedRealtimeStream, subscription: StatusSubscription) {
  return (
    stream.transportConnected &&
    hasRequiredRealtimeReadiness(stream.readiness, subscription.requiredChannels)
  );
}

function emitStatuses(stream: SharedRealtimeStream) {
  for (const [listener, subscription] of stream.statusListeners) {
    const ready = isSubscriptionReady(stream, subscription);
    if (subscription.lastReady === ready) continue;
    subscription.lastReady = ready;
    try {
      listener(ready);
    } catch (error) {
      logRealtimeListenerError(stream, 'notify_status_listener', error);
    }
  }
}

function setTransportConnected(stream: SharedRealtimeStream, connected: boolean) {
  stream.transportConnected = connected;
  if (!connected) stream.readiness = null;
  emitStatuses(stream);
}

function setReadiness(stream: SharedRealtimeStream, readiness: RealtimeReadiness) {
  stream.readiness = readiness;
  emitStatuses(stream);
}

function markPresenceUnready(stream: SharedRealtimeStream) {
  if (!stream.readiness || !stream.readiness.presence) return;
  stream.readiness = { ...stream.readiness, presence: false };
  emitStatuses(stream);
}

function scheduleReconnect(stream: SharedRealtimeStream, delayMs: number) {
  clearReconnectTimer(stream);
  stream.reconnectTimer = setTimeout(() => {
    stream.reconnectTimer = null;
    void connectSharedStream(stream);
  }, delayMs);
}

function parseSseChunk(chunk: string) {
  let event = 'message';
  const data: string[] = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trimStart();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null;
}

function dispatchSseChunk(stream: SharedRealtimeStream, chunk: string) {
  const sse = parseSseChunk(chunk);
  if (!sse) return;
  const parsed = parseSsePayload(sse.data);
  if (parsed == null) return;

  if (sse.event === REALTIME_READINESS_EVENT) {
    const readiness = parseRealtimeReadiness(parsed);
    if (readiness) setReadiness(stream, readiness);
    return;
  }
  if (sse.event !== 'message') return;

  const event = normalizeSharedSsePayload(parsed);
  if (event == null) return;
  for (const listener of stream.listeners) {
    try {
      listener(event);
    } catch (error) {
      logRealtimeListenerError(stream, 'notify_event_listener', error);
    }
  }
}

function normalizeSharedSsePayload(parsed: unknown): unknown | null {
  if (Array.isArray(parsed)) {
    const notifications = normalizeNotificationStreamPayload(parsed, {
      contentPolicy: 'sse-safe',
    });
    if (parsed.length > 0 && notifications.length === 0) return null;
    return notifications;
  }

  return normalizeRealtimeEventPayload(parsed);
}

function parseSsePayload(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function connectSharedStream(stream: SharedRealtimeStream) {
  if (stream.stopped || stream.listeners.size === 0) return;

  setTransportConnected(stream, false);
  const controller = new AbortController();
  stream.abortController = controller;

  try {
    const response = await fetch(buildStreamUrl(stream), {
      headers: buildOrgHeaders(stream.orgId),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error('Failed to open realtime stream');
    }

    setTransportConnected(stream, true);
    stream.reconnectAttempt = 0;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!stream.stopped) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        dispatchSseChunk(stream, chunk);
      }
    }

    if (!stream.stopped && stream.listeners.size > 0) {
      setTransportConnected(stream, false);
      stream.reconnectAttempt = 0;
      scheduleReconnect(stream, 1_000);
    }
  } catch {
    if (stream.stopped || stream.listeners.size === 0) return;
    setTransportConnected(stream, false);
    const attempt = stream.reconnectAttempt;
    stream.reconnectAttempt = attempt + 1;
    scheduleReconnect(stream, Math.min(1000 * Math.pow(2, attempt), 30_000));
  } finally {
    if (stream.abortController === controller) {
      stream.abortController = null;
    }
  }
}

function stopSharedStream(stream: SharedRealtimeStream) {
  stream.stopped = true;
  clearReconnectTimer(stream);
  clearPresenceTargetReconnectTimer(stream);
  if (stream.abortController) {
    stream.abortController.abort();
    stream.abortController = null;
  }
  setTransportConnected(stream, false);
  streams.delete(stream.orgId);
}

function getOrCreateSharedStream(orgId: string) {
  const existing = streams.get(orgId);
  if (existing) return existing;

  const stream: SharedRealtimeStream = {
    orgId,
    listeners: new Set(),
    statusListeners: new Map(),
    presenceTargets: new Map(),
    abortController: null,
    reconnectTimer: null,
    presenceTargetReconnectTimer: null,
    reconnectAttempt: 0,
    transportConnected: false,
    readiness: null,
    stopped: false,
  };
  streams.set(orgId, stream);
  return stream;
}

export function subscribeSharedRealtimeStream(args: {
  orgId: string;
  onEvent: RealtimeListener;
  onStatus?: StatusListener;
  presenceTargets?: RealtimePresenceTarget[];
  requiredChannels?: readonly RealtimeChannel[];
}) {
  const stream = getOrCreateSharedStream(args.orgId);
  stream.listeners.add(args.onEvent);
  const targetKeys: string[] = [];
  let presenceTargetsChanged = false;

  for (const target of args.presenceTargets ?? []) {
    const key = presenceTargetKey(target);
    targetKeys.push(key);
    const existing = stream.presenceTargets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      stream.presenceTargets.set(key, { target, count: 1 });
      presenceTargetsChanged = true;
    }
  }

  if (args.onStatus) {
    const subscription: StatusSubscription = {
      requiredChannels: [...new Set(args.requiredChannels ?? DEFAULT_REQUIRED_CHANNELS)],
      lastReady: false,
    };
    stream.statusListeners.set(args.onStatus, subscription);
    try {
      const ready = isSubscriptionReady(stream, subscription);
      subscription.lastReady = ready;
      args.onStatus(ready);
    } catch (error) {
      logRealtimeListenerError(stream, 'notify_status_listener', error);
    }
  }

  if (presenceTargetsChanged) {
    markPresenceUnready(stream);
    schedulePresenceTargetReconnect(stream);
  }

  if (!stream.abortController && !stream.reconnectTimer) {
    void connectSharedStream(stream);
  }

  return () => {
    stream.listeners.delete(args.onEvent);
    let removedPresenceTarget = false;
    for (const key of targetKeys) {
      const existing = stream.presenceTargets.get(key);
      if (!existing) continue;
      existing.count -= 1;
      if (existing.count <= 0) {
        stream.presenceTargets.delete(key);
        removedPresenceTarget = true;
      }
    }
    if (args.onStatus) {
      stream.statusListeners.delete(args.onStatus);
    }
    if (removedPresenceTarget && stream.listeners.size > 0) {
      markPresenceUnready(stream);
      schedulePresenceTargetReconnect(stream);
    }
    if (stream.listeners.size === 0) {
      stopSharedStream(stream);
    }
  };
}

export function resetSharedRealtimeStreamsForTests() {
  for (const stream of streams.values()) {
    stopSharedStream(stream);
  }
  streams.clear();
}
