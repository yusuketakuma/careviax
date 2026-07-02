'use client';

import { normalizeRealtimeEventPayload } from '@/lib/realtime/events';

type RealtimeListener = (event: unknown) => void;
type StatusListener = (connected: boolean) => void;

export type RealtimePresenceTarget = {
  entityType: string;
  entityId: string;
};

type SharedRealtimeStream = {
  orgId: string;
  listeners: Set<RealtimeListener>;
  statusListeners: Set<StatusListener>;
  presenceTargets: Map<string, { target: RealtimePresenceTarget; count: number }>;
  abortController: AbortController | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  presenceTargetReconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  connected: boolean;
  stopped: boolean;
};

const PRESENCE_TARGET_RECONNECT_DEBOUNCE_MS = 150;
const REALTIME_LISTENER_FAILED_MESSAGE = 'Realtime listener failed';
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

function logRealtimeListenerError(error: unknown) {
  console.error('[realtime] listener failed', {
    kind: error instanceof Error ? 'Error' : typeof error,
    message: REALTIME_LISTENER_FAILED_MESSAGE,
  });
}

function emitStatus(stream: SharedRealtimeStream, connected: boolean) {
  if (stream.connected === connected) return;
  stream.connected = connected;
  for (const listener of stream.statusListeners) {
    try {
      listener(connected);
    } catch (error) {
      logRealtimeListenerError(error);
    }
  }
}

function scheduleReconnect(stream: SharedRealtimeStream, delayMs: number) {
  clearReconnectTimer(stream);
  stream.reconnectTimer = setTimeout(() => {
    stream.reconnectTimer = null;
    void connectSharedStream(stream);
  }, delayMs);
}

function dispatchSseChunk(stream: SharedRealtimeStream, chunk: string) {
  if (!chunk.startsWith('data: ')) return;
  const parsed = parseSsePayload(chunk.slice(6));
  if (parsed == null) return;
  const event = normalizeRealtimeEventPayload(parsed) ?? parsed;
  for (const listener of stream.listeners) {
    try {
      listener(event);
    } catch (error) {
      logRealtimeListenerError(error);
    }
  }
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

  const controller = new AbortController();
  stream.abortController = controller;

  try {
    const response = await fetch(buildStreamUrl(stream), {
      headers: { 'x-org-id': stream.orgId },
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error('Failed to open realtime stream');
    }

    emitStatus(stream, true);
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
      emitStatus(stream, false);
      stream.reconnectAttempt = 0;
      scheduleReconnect(stream, 1_000);
    }
  } catch {
    if (stream.stopped || stream.listeners.size === 0) return;
    emitStatus(stream, false);
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
  emitStatus(stream, false);
  streams.delete(stream.orgId);
}

function getOrCreateSharedStream(orgId: string) {
  const existing = streams.get(orgId);
  if (existing) return existing;

  const stream: SharedRealtimeStream = {
    orgId,
    listeners: new Set(),
    statusListeners: new Set(),
    presenceTargets: new Map(),
    abortController: null,
    reconnectTimer: null,
    presenceTargetReconnectTimer: null,
    reconnectAttempt: 0,
    connected: false,
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
    stream.statusListeners.add(args.onStatus);
    try {
      args.onStatus(stream.connected);
    } catch (error) {
      logRealtimeListenerError(error);
    }
  }

  if (presenceTargetsChanged) {
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
