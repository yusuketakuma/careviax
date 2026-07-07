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

type ConsoleErrorSpy = { mock: { calls: unknown[][] } };

function parseConsoleErrorJson(spy: ConsoleErrorSpy) {
  return spy.mock.calls.flatMap((call) => {
    const [line] = call;
    if (typeof line !== 'string') return [];
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
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
    const eventError = new Error('event listener failed token=secret');
    const statusError = new Error('status listener failed patient=患者A db_password=value');
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
    const parsedLogs = parseConsoleErrorJson(consoleError);
    expect(parsedLogs).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'realtime.listener_failed',
        service: 'ph-os',
        event: 'realtime.listener_failed',
        route: '/api/notifications/stream',
        method: 'GET',
        orgId: 'org_1',
        operation: 'notify_event_listener',
        error_name: 'Error',
      }),
    );
    expect(parsedLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'realtime.listener_failed',
          operation: 'notify_status_listener',
          error_name: 'Error',
        }),
      ]),
    );
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain('token=secret');
    expect(logged).not.toContain('db_password=value');
    expect(logged).not.toContain('患者A');

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

  it('redacts notification array payloads before notifying shared stream listeners', async () => {
    const listener = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      createOpenSseResponse([
        `data: ${JSON.stringify([
          {
            id: 'notification_1',
            type: 'urgent',
            title: '田中 一郎さんのモルヒネ残薬確認',
            message: '山田花子 090-1234-5678 / モルヒネ硫酸塩徐放錠10mg',
            link: '/patients/patient_1/reports/report_1?token=secret',
            is_read: false,
            created_at: '2026-05-31T00:04:00.000Z',
            raw_message: '患者 山田花子 090-1234-5678',
            metadata: { token: 'raw-token-secret' },
            provider_error: 'storage_key=org_1/patients/patient_1/file.pdf',
            storage_key: 'org_1/patients/patient_1/file.pdf',
            signed_url: 'https://s3.example.test/file?X-Amz-Signature=secret',
          },
        ])}\n\n`,
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribe = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: listener,
    });

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith([
        {
          id: 'notification_1',
          type: 'urgent',
          title: '緊急通知',
          message: 'アプリで詳細を確認してください',
          link: '/notifications',
          is_read: false,
          created_at: '2026-05-31T00:04:00.000Z',
        },
      ]);
    });

    const serialized = JSON.stringify(listener.mock.calls);
    expect(serialized).not.toContain('田中');
    expect(serialized).not.toContain('山田花子');
    expect(serialized).not.toContain('090-1234-5678');
    expect(serialized).not.toContain('モルヒネ');
    expect(serialized).not.toContain('硫酸塩徐放錠');
    expect(serialized).not.toContain('/patients/');
    expect(serialized).not.toContain('patient_1');
    expect(serialized).not.toContain('report_1');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('raw_message');
    expect(serialized).not.toContain('metadata');
    expect(serialized).not.toContain('provider_error');
    expect(serialized).not.toContain('storage_key');
    expect(serialized).not.toContain('signed_url');
    expect(serialized).not.toContain('X-Amz-Signature');
    expect(serialized).not.toContain('raw-token-secret');

    unsubscribe();
  });

  it('does not notify listeners for non-empty notification arrays that normalize to empty', async () => {
    const listener = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      createOpenSseResponse([
        `data: ${JSON.stringify([
          {
            id: 'notification_unsafe',
            type: 'unknown',
            title: '患者名',
            message: '薬剤名',
            link: 'https://example.test/private',
            is_read: false,
            created_at: '2026-05-31T00:04:00.000Z',
          },
        ])}\n\n`,
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribe = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: listener,
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('preserves explicit empty notification array payloads', async () => {
    const listener = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(createOpenSseResponse(['data: []\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const unsubscribe = subscribeSharedRealtimeStream({
      orgId: 'org_1',
      onEvent: listener,
    });

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith([]);
    });

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
