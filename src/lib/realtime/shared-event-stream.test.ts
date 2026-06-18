import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetSharedRealtimeStreamsForTests,
  subscribeSharedRealtimeStream,
} from './shared-event-stream';

function createOpenSseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
      },
    }),
  );
}

function createHangingSseResponse() {
  return new Response(
    new ReadableStream({
      start() {
        // Keep the connection open until the AbortSignal is triggered by the shared stream.
      },
    }),
  );
}

describe('subscribeSharedRealtimeStream', () => {
  afterEach(() => {
    resetSharedRealtimeStreamsForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shares one SSE connection across multiple listeners for the same org', async () => {
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const firstStatus = vi.fn();
    const secondStatus = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createOpenSseResponse([
          'data: {"type":"notification_created","notification_id":"notification_1"}\n\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribeFirst = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: firstListener,
      onStatus: firstStatus,
    });
    const unsubscribeSecond = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: secondListener,
      onStatus: secondStatus,
    });

    await vi.waitFor(() => {
      expect(firstListener).toHaveBeenCalledWith({
        type: 'notification_created',
        notification_id: 'notification_1',
      });
      expect(secondListener).toHaveBeenCalledWith({
        type: 'notification_created',
        notification_id: 'notification_1',
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notifications/stream',
      expect.objectContaining({
        headers: { 'x-org-id': 'org_1' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(firstStatus).toHaveBeenCalledWith(false);
    expect(firstStatus).toHaveBeenCalledWith(true);
    expect(secondStatus).toHaveBeenCalledWith(false);
    expect(secondStatus).toHaveBeenCalledWith(true);

    const signal = (fetchMock.mock.calls[0]?.[1] as { signal: AbortSignal } | undefined)?.signal;
    expect(signal).toBeTruthy();
    unsubscribeFirst();
    expect(signal?.aborted).toBe(false);
    unsubscribeSecond();
    expect(signal?.aborted).toBe(true);
  });

  it('isolates listener exceptions without reconnecting the shared stream', async () => {
    const eventError = new Error('event listener failed');
    const statusError = new Error('status listener failed');
    const throwingListener = vi.fn(() => {
      throw eventError;
    });
    const secondListener = vi.fn();
    const throwingStatus = vi.fn(() => {
      throw statusError;
    });
    const secondStatus = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createOpenSseResponse([
          'data: {"type":"notification_created","notification_id":"notification_1"}\n\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribeFirst = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: throwingListener,
      onStatus: throwingStatus,
    });
    const unsubscribeSecond = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: secondListener,
      onStatus: secondStatus,
    });

    await vi.waitFor(() => {
      expect(secondListener).toHaveBeenCalledWith({
        type: 'notification_created',
        notification_id: 'notification_1',
      });
      expect(secondStatus).toHaveBeenCalledWith(true);
    });

    expect(throwingListener).toHaveBeenCalledTimes(1);
    expect(throwingStatus).toHaveBeenCalledTimes(2);
    expect(secondStatus).toHaveBeenCalledWith(false);
    expect(secondStatus).toHaveBeenCalledWith(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenCalledWith('[realtime] listener failed', {
      name: 'Error',
      message: eventError.message,
    });
    expect(consoleError).toHaveBeenCalledWith('[realtime] listener failed', {
      name: 'Error',
      message: statusError.message,
    });

    unsubscribeSecond();
    unsubscribeFirst();
  });

  it('passes requested presence targets on the shared SSE URL', async () => {
    const listener = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createOpenSseResponse([
          'data: {"type":"presence_update","entity_type":"visit_record","entity_id":"vr_1"}\n\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribe = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: listener,
      presenceTargets: [{ entityType: 'visit_record', entityId: 'vr_1' }],
    });

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({
        type: 'presence_update',
        entity_type: 'visit_record',
        entity_id: 'vr_1',
      });
    });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/^\/api\/notifications\/stream\?/);
    expect(new URLSearchParams(url.split('?')[1]).getAll('presence')).toEqual([
      JSON.stringify(['visit_record', 'vr_1']),
    ]);

    unsubscribe();
  });

  it('debounces active SSE reconnects when presence targets change in a burst', async () => {
    vi.useFakeTimers();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const thirdListener = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createHangingSseResponse())
      .mockResolvedValueOnce(createHangingSseResponse());
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribeFirst = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: firstListener,
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const firstSignal = (fetchMock.mock.calls[0]?.[1] as { signal: AbortSignal } | undefined)
      ?.signal;
    const abortListener = vi.fn();
    firstSignal?.addEventListener('abort', abortListener);

    const unsubscribeSecond = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: secondListener,
      presenceTargets: [{ entityType: 'patient', entityId: 'patient_1' }],
    });
    const unsubscribeThird = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: thirdListener,
      presenceTargets: [{ entityType: 'patient', entityId: 'patient_2' }],
    });

    expect(firstSignal?.aborted).toBe(false);
    expect(abortListener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(149);
    expect(firstSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(firstSignal?.aborted).toBe(true);
    expect(abortListener).toHaveBeenCalledTimes(1);

    unsubscribeThird();
    unsubscribeSecond();
    unsubscribeFirst();
  });
});
