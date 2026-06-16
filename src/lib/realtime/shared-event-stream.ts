'use client';

import { normalizeRealtimeEventPayload } from '@/lib/realtime/events';

type RealtimeListener = (event: unknown) => void;
type StatusListener = (connected: boolean) => void;

type SharedRealtimeStream = {
  orgId: string;
  listeners: Set<RealtimeListener>;
  statusListeners: Set<StatusListener>;
  abortController: AbortController | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  connected: boolean;
  stopped: boolean;
};

const streams = new Map<string, SharedRealtimeStream>();

function clearReconnectTimer(stream: SharedRealtimeStream) {
  if (!stream.reconnectTimer) return;
  clearTimeout(stream.reconnectTimer);
  stream.reconnectTimer = null;
}

function emitStatus(stream: SharedRealtimeStream, connected: boolean) {
  if (stream.connected === connected) return;
  stream.connected = connected;
  for (const listener of stream.statusListeners) {
    listener(connected);
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
    listener(event);
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
    const response = await fetch('/api/notifications/stream', {
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
    abortController: null,
    reconnectTimer: null,
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
}) {
  const stream = getOrCreateSharedStream(args.orgId);
  stream.listeners.add(args.onEvent);
  if (args.onStatus) {
    stream.statusListeners.add(args.onStatus);
    args.onStatus(stream.connected);
  }

  if (!stream.abortController && !stream.reconnectTimer) {
    void connectSharedStream(stream);
  }

  return () => {
    stream.listeners.delete(args.onEvent);
    if (args.onStatus) {
      stream.statusListeners.delete(args.onStatus);
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
