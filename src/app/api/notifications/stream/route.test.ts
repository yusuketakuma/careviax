import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAuthContextMock,
  notificationFindManyMock,
  acquireSseConnectionMock,
  releaseSseConnectionMock,
  subscribeToChannelMock,
  unsubscribeFromChannelMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  acquireSseConnectionMock: vi.fn(),
  releaseSseConnectionMock: vi.fn(),
  subscribeToChannelMock: vi.fn(),
  unsubscribeFromChannelMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    notification: {
      findMany: notificationFindManyMock,
    },
  },
}));

vi.mock('@/lib/api/rate-limit', () => ({
  acquireSseConnection: acquireSseConnectionMock,
  releaseSseConnection: releaseSseConnectionMock,
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    subscribeToChannel: subscribeToChannelMock,
    unsubscribeFromChannel: unsubscribeFromChannelMock,
  }),
}));

import { GET } from './route';

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function openStreamForTest() {
  const controller = new AbortController();
  const response = (await GET({
    signal: controller.signal,
  } as Request as never))!;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('reader is required');
  await reader.read();
  await flushAsyncWork();
  return { controller, reader };
}

async function readSseData(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const chunk = await reader.read();
  const text = new TextDecoder().decode(chunk.value);
  if (!text.startsWith('data: ')) throw new Error(`unexpected SSE chunk: ${text}`);
  return JSON.parse(text.slice(6));
}

describe('/api/notifications/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    notificationFindManyMock.mockResolvedValue([]);
    acquireSseConnectionMock.mockReturnValue({ allowed: true });
    subscribeToChannelMock.mockResolvedValue(undefined);
  });

  it('opens an SSE stream and immediately emits keepalive', async () => {
    const controller = new AbortController();
    const response = (await GET({
      signal: controller.signal,
    } as Request as never))!;

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    const firstChunk = await reader.read();
    controller.abort();
    await flushAsyncWork();
    const text = new TextDecoder().decode(firstChunk.value);
    expect(text).toBe(': keepalive\n\n');
    expect(releaseSseConnectionMock).toHaveBeenCalledWith('user_1');
    expect(releaseSseConnectionMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('org:org_1', expect.any(Function));
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('user:user_1', expect.any(Function));
  });

  it('rejects streams when the per-user connection cap is reached', async () => {
    acquireSseConnectionMock.mockReturnValue({ allowed: false, count: 10 });

    const response = (await GET({
      signal: new AbortController().signal,
    } as Request as never))!;

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'SSE_CONNECTION_LIMIT',
    });
    expect(acquireSseConnectionMock).toHaveBeenCalledWith('user_1');
    expect(subscribeToChannelMock).not.toHaveBeenCalled();
    expect(notificationFindManyMock).not.toHaveBeenCalled();
    expect(releaseSseConnectionMock).not.toHaveBeenCalled();
  });

  it('releases the connection when the stream body is cancelled', async () => {
    const response = (await GET({
      signal: new AbortController().signal,
    } as Request as never))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();

    await reader.cancel();
    await flushAsyncWork();

    expect(releaseSseConnectionMock).toHaveBeenCalledWith('user_1');
    expect(releaseSseConnectionMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('org:org_1', expect.any(Function));
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('user:user_1', expect.any(Function));
  });

  it('releases the connection exactly once when abort and body cancel both happen', async () => {
    const controller = new AbortController();
    const response = (await GET({
      signal: controller.signal,
    } as Request as never))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();

    controller.abort();
    await reader.cancel();
    await flushAsyncWork();

    expect(releaseSseConnectionMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeFromChannelMock).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes a realtime channel that succeeds after the stream is aborted', async () => {
    const deferredOrgSubscribe = createDeferred();
    subscribeToChannelMock
      .mockReturnValueOnce(deferredOrgSubscribe.promise)
      .mockResolvedValueOnce(undefined);

    const controller = new AbortController();
    const response = (await GET({
      signal: controller.signal,
    } as Request as never))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();

    controller.abort();
    await flushAsyncWork();
    deferredOrgSubscribe.resolve();
    await flushAsyncWork();

    expect(releaseSseConnectionMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('org:org_1', expect.any(Function));
  });

  it('cleans up successful realtime subscriptions when another subscription fails', async () => {
    subscribeToChannelMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('user channel unavailable'));

    const controller = new AbortController();
    const response = (await GET({
      signal: controller.signal,
    } as Request as never))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();
    await flushAsyncWork();

    controller.abort();
    await flushAsyncWork();

    expect(unsubscribeFromChannelMock).toHaveBeenCalledTimes(2);
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('org:org_1', expect.any(Function));
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('user:user_1', expect.any(Function));
    expect(releaseSseConnectionMock).toHaveBeenCalledWith('user_1');
    expect(releaseSseConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes realtime listeners when adapter registration rejects after a side effect', async () => {
    subscribeToChannelMock
      .mockRejectedValueOnce(new Error('redis subscribe failed'))
      .mockResolvedValueOnce(undefined);

    const controller = new AbortController();
    const response = (await GET({
      signal: controller.signal,
    } as Request as never))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();
    await flushAsyncWork();

    controller.abort();
    await flushAsyncWork();

    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('org:org_1', expect.any(Function));
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('user:user_1', expect.any(Function));
    expect(releaseSseConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('redacts identifiers from org-wide realtime payloads before streaming', async () => {
    const { controller, reader } = await openStreamForTest();
    const orgListener = subscribeToChannelMock.mock.calls.find(
      ([channel]) => channel === 'org:org_1',
    )?.[1] as ((data: unknown) => void) | undefined;
    if (!orgListener) throw new Error('org listener is required');

    orgListener({
      type: 'cycle_transition',
      payload: {
        source: 'medication_cycles_transition',
        cycleId: 'cycle_1',
        case_id: 'case_1',
        schedule_id: 'schedule_1',
        patientId: 'patient_1',
        from: 'dispensing',
        to: 'dispensed',
      },
    });

    await expect(readSseData(reader)).resolves.toEqual({
      type: 'cycle_transition',
      payload: { source: 'medication_cycles_transition' },
    });

    controller.abort();
    await flushAsyncWork();
  });

  it('drops non-allowlisted source values from org-wide realtime payloads before streaming', async () => {
    const { controller, reader } = await openStreamForTest();
    const orgListener = subscribeToChannelMock.mock.calls.find(
      ([channel]) => channel === 'org:org_1',
    )?.[1] as ((data: unknown) => void) | undefined;
    if (!orgListener) throw new Error('org listener is required');

    orgListener({
      type: 'workflow_refresh',
      payload: {
        source: 'case_1',
        case_id: 'case_1',
        patientId: 'patient_1',
        schedule_id: 'schedule_1',
      },
    });

    await expect(readSseData(reader)).resolves.toEqual({
      type: 'workflow_refresh',
    });

    controller.abort();
    await flushAsyncWork();
  });

  it('keeps user-channel notification payloads intact', async () => {
    const { controller, reader } = await openStreamForTest();
    const userListener = subscribeToChannelMock.mock.calls.find(
      ([channel]) => channel === 'user:user_1',
    )?.[1] as ((data: unknown) => void) | undefined;
    if (!userListener) throw new Error('user listener is required');

    userListener([
      {
        id: 'notification_1',
        type: 'visit',
        message: '訪問予定が更新されました',
        created_at: '2026-04-01T00:00:00.000Z',
        is_read: false,
      },
    ]);

    await expect(readSseData(reader)).resolves.toEqual([
      expect.objectContaining({
        id: 'notification_1',
        message: '訪問予定が更新されました',
      }),
    ]);

    controller.abort();
    await flushAsyncWork();
  });

  it('allows redacted QR draft invalidation events without identifier payloads', async () => {
    const { controller, reader } = await openStreamForTest();
    const orgListener = subscribeToChannelMock.mock.calls.find(
      ([channel]) => channel === 'org:org_1',
    )?.[1] as ((data: unknown) => void) | undefined;
    if (!orgListener) throw new Error('org listener is required');

    orgListener({
      type: 'qr_draft_created',
      payload: {
        draftId: 'draft_1',
        sessionId: 'session_1',
        patientId: 'patient_1',
      },
    });

    await expect(readSseData(reader)).resolves.toEqual({
      type: 'qr_draft_created',
    });

    controller.abort();
    await flushAsyncWork();
  });

  it('uses a bounded polling window when realtime subscription fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    subscribeToChannelMock.mockRejectedValue(new Error('realtime unavailable'));

    const controller = new AbortController();
    const response = (await GET({
      signal: controller.signal,
    } as Request as never))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();

    vi.setSystemTime(new Date('2026-04-01T00:00:05.000Z'));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(notificationFindManyMock).toHaveBeenCalledTimes(1);
    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          user_id: 'user_1',
          is_read: false,
          created_at: expect.objectContaining({
            gt: new Date('2026-04-01T00:00:00.000Z'),
            lte: expect.any(Date),
          }),
        }),
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
    );

    const firstCall = notificationFindManyMock.mock.calls[0]?.[0];
    expect(firstCall?.where.created_at.lte.getTime()).toBeGreaterThan(
      firstCall?.where.created_at.gt.getTime(),
    );

    controller.abort();
    await vi.runOnlyPendingTimersAsync();
  });
});
