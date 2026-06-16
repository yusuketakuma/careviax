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

describe('subscribeSharedRealtimeStream', () => {
  afterEach(() => {
    resetSharedRealtimeStreamsForTests();
    vi.unstubAllGlobals();
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
});
