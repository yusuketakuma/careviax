import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { scheduleSseTimer } from './sse-timer';

const {
  requireAuthContextMock,
  notificationFindManyMock,
  acquireSseConnectionMock,
  releaseSseConnectionMock,
  subscribeToChannelMock,
  unsubscribeFromChannelMock,
  canAccessCollaborationEntityMock,
  loggerWarnMock,
  loggerInfoMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  acquireSseConnectionMock: vi.fn(),
  releaseSseConnectionMock: vi.fn(),
  subscribeToChannelMock: vi.fn(),
  unsubscribeFromChannelMock: vi.fn(),
  canAccessCollaborationEntityMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: vi.fn(),
  },
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

vi.mock('@/server/services/collaboration-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/collaboration-access')>();
  return {
    ...actual,
    canAccessCollaborationEntity: canAccessCollaborationEntityMock,
  };
});

import { GET } from './route';

function streamRequest(signal: AbortSignal, url = 'http://localhost/api/notifications/stream') {
  return new NextRequest(url, { signal });
}

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
  return openStreamForTestWithUrl('http://localhost/api/notifications/stream');
}

async function openStreamForTestWithUrl(url: string) {
  const controller = new AbortController();
  const response = (await GET(streamRequest(controller.signal, url)))!;
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
    canAccessCollaborationEntityMock.mockResolvedValue(true);
  });

  it('opens an SSE stream and immediately emits keepalive', async () => {
    const controller = new AbortController();
    const response = (await GET(streamRequest(controller.signal)))!;

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Cache-Control')).toContain('no-cache');
    expect(response.headers.get('Cache-Control')).toContain('no-transform');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    const firstChunk = await reader.read();
    controller.abort();
    await Promise.resolve();
    const text = new TextDecoder().decode(firstChunk.value);
    expect(text).toBe(': keepalive\n\n');
    expect(releaseSseConnectionMock).toHaveBeenCalledWith('user_1');
    expect(releaseSseConnectionMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('org:org_1', expect.any(Function));
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('user:user_1', expect.any(Function));
  });

  it('unrefs SSE timers when the runtime exposes timer handles', () => {
    const timeout = { unref: vi.fn() };
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timeout as never);
    const callback = vi.fn();

    expect(scheduleSseTimer(callback, 1000)).toBe(timeout);

    expect(setTimeoutSpy).toHaveBeenCalledWith(callback, 1000);
    expect(timeout.unref).toHaveBeenCalledOnce();
    setTimeoutSpy.mockRestore();
  });

  it('rejects streams when the per-user connection cap is reached', async () => {
    acquireSseConnectionMock.mockReturnValue({ allowed: false, count: 10 });

    const response = (await GET(streamRequest(new AbortController().signal)))!;

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    await expect(response.json()).resolves.toMatchObject({
      code: 'SSE_CONNECTION_LIMIT',
    });
    expect(acquireSseConnectionMock).toHaveBeenCalledWith('user_1');
    expect(subscribeToChannelMock).not.toHaveBeenCalled();
    expect(notificationFindManyMock).not.toHaveBeenCalled();
    expect(releaseSseConnectionMock).not.toHaveBeenCalled();
  });

  it('releases the connection when the stream body is cancelled', async () => {
    const response = (await GET(streamRequest(new AbortController().signal)))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();

    await reader.cancel();
    await Promise.resolve();

    expect(releaseSseConnectionMock).toHaveBeenCalledWith('user_1');
    expect(releaseSseConnectionMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('org:org_1', expect.any(Function));
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith('user:user_1', expect.any(Function));
  });

  it('releases the connection exactly once when abort and body cancel both happen', async () => {
    const controller = new AbortController();
    const response = (await GET(streamRequest(controller.signal)))!;
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
    const response = (await GET(streamRequest(controller.signal)))!;
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
    const response = (await GET(streamRequest(controller.signal)))!;
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
    const response = (await GET(streamRequest(controller.signal)))!;
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

  it('normalizes user-channel notification payloads before streaming', async () => {
    const { controller, reader } = await openStreamForTest();
    const userListener = subscribeToChannelMock.mock.calls.find(
      ([channel]) => channel === 'user:user_1',
    )?.[1] as ((data: unknown) => void) | undefined;
    if (!userListener) throw new Error('user listener is required');

    userListener([
      {
        id: 'notification_1',
        type: 'business',
        title: '患者対応',
        message: '訪問予定が更新されました',
        link: '/notifications?tab=unread',
        created_at: '2026-04-01T00:00:00.000Z',
        is_read: false,
        patient_name: '山田花子',
        address: '東京都千代田区丸の内1-1-1',
        phone: '090-1234-5678',
        drug_name: 'モルヒネ硫酸塩徐放錠10mg',
        raw_message: '患者 山田花子 090-1234-5678',
        metadata: { token: 'raw-token-secret' },
        provider_error: 'storage_key=org_1/patients/patient_1/reports/report_1.pdf',
        token: 'raw-token-secret',
        storage_key: 'org_1/patients/patient_1/reports/report_1.pdf',
        signed_url: 'https://s3.example.test/file?X-Amz-Signature=secret',
      },
    ]);

    const payload = await readSseData(reader);
    expect(payload).toEqual([
      {
        id: 'notification_1',
        type: 'business',
        title: '業務通知',
        message: 'アプリで詳細を確認してください',
        link: '/notifications',
        created_at: '2026-04-01T00:00:00.000Z',
        is_read: false,
      },
    ]);
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      '山田花子',
      '東京都千代田区',
      '090-1234-5678',
      '硫酸塩徐放錠',
      '患者対応',
      '訪問予定が更新されました',
      'tab=unread',
      'raw_message',
      'metadata',
      'provider_error',
      'raw-token-secret',
      'storage_key',
      'signed_url',
      'X-Amz-Signature',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    controller.abort();
    await flushAsyncWork();
  });

  it('subscribes authorized presence rooms and streams only sanitized presence payloads', async () => {
    const presence = encodeURIComponent(JSON.stringify(['visit_record', 'vr_1']));
    const { controller, reader } = await openStreamForTestWithUrl(
      `http://localhost/api/notifications/stream?presence=${presence}`,
    );
    const presenceListener = subscribeToChannelMock.mock.calls.find(
      ([channel]) => channel === 'presence:org_1:visit_record:vr_1',
    )?.[1] as ((data: unknown) => void) | undefined;
    if (!presenceListener) throw new Error('presence listener is required');

    expect(canAccessCollaborationEntityMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      'visit_record',
      'vr_1',
    );

    presenceListener({
      type: 'presence_update',
      entity_type: 'visit_record',
      entity_id: 'vr_1',
      user_id: 'user_2',
      display_name: '田中',
      active_field: 'note',
      updated_at: '2026-06-17T00:00:00.000Z',
      leaked: 'drop-me',
    });

    await expect(readSseData(reader)).resolves.toEqual({
      type: 'presence_update',
      entity_type: 'visit_record',
      entity_id: 'vr_1',
      user_id: 'user_2',
      display_name: '田中',
      active_field: 'note',
      updated_at: '2026-06-17T00:00:00.000Z',
    });

    controller.abort();
    await flushAsyncWork();
    expect(unsubscribeFromChannelMock).toHaveBeenCalledWith(
      'presence:org_1:visit_record:vr_1',
      expect.any(Function),
    );
  });

  it('rejects invalid presence stream targets before acquiring an SSE slot', async () => {
    const response = (await GET(
      streamRequest(
        new AbortController().signal,
        'http://localhost/api/notifications/stream?presence=not-json',
      ),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_PRESENCE_STREAM_ROOM',
    });
    expect(acquireSseConnectionMock).not.toHaveBeenCalled();
    expect(subscribeToChannelMock).not.toHaveBeenCalled();
  });

  it('rejects inaccessible presence stream targets before subscribing channels', async () => {
    canAccessCollaborationEntityMock.mockResolvedValue(false);
    const presence = encodeURIComponent(JSON.stringify(['visit_record', 'vr_unassigned']));

    const response = (await GET(
      streamRequest(
        new AbortController().signal,
        `http://localhost/api/notifications/stream?presence=${presence}`,
      ),
    ))!;

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PRESENCE_STREAM_ROOM_NOT_FOUND',
    });
    expect(acquireSseConnectionMock).not.toHaveBeenCalled();
    expect(subscribeToChannelMock).not.toHaveBeenCalled();
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
    const response = (await GET(streamRequest(controller.signal)))!;
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
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          link: true,
          is_read: true,
          created_at: true,
        },
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

  it('normalizes DB safety poll notifications before streaming', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    subscribeToChannelMock.mockRejectedValue(new Error('realtime unavailable'));
    notificationFindManyMock.mockResolvedValueOnce([
      {
        id: 'notification_db_1',
        type: 'urgent',
        title: '患者対応',
        message: '訪問前確認があります',
        link: '/notifications',
        is_read: false,
        created_at: new Date('2026-04-01T00:00:04.000Z'),
        patient_name: '山田花子',
        address: '東京都千代田区丸の内1-1-1',
        phone: '090-1234-5678',
        drug_name: 'モルヒネ硫酸塩徐放錠10mg',
        raw_message: '患者 山田花子 090-1234-5678',
        metadata: { token: 'raw-token-secret' },
        provider_error: 'storage_key=org_1/patients/patient_1/reports/report_1.pdf',
        token: 'raw-token-secret',
        storage_key: 'org_1/patients/patient_1/reports/report_1.pdf',
        signed_url: 'https://s3.example.test/file?X-Amz-Signature=secret',
      },
    ]);

    const controller = new AbortController();
    const response = (await GET(streamRequest(controller.signal)))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();

    vi.setSystemTime(new Date('2026-04-01T00:00:05.000Z'));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          link: true,
          is_read: true,
          created_at: true,
        },
      }),
    );
    const payload = await readSseData(reader);
    expect(payload).toEqual([
      {
        id: 'notification_db_1',
        type: 'urgent',
        title: '緊急通知',
        message: 'アプリで詳細を確認してください',
        link: '/notifications',
        is_read: false,
        created_at: '2026-04-01T00:00:04.000Z',
      },
    ]);
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      '山田花子',
      '東京都千代田区',
      '090-1234-5678',
      '硫酸塩徐放錠',
      '患者対応',
      '訪問前確認があります',
      'raw_message',
      'metadata',
      'provider_error',
      'raw-token-secret',
      'storage_key',
      'signed_url',
      'X-Amz-Signature',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    controller.abort();
    await vi.runOnlyPendingTimersAsync();
  });

  it('logs a warning but keeps the stream alive when a safety poll fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
    subscribeToChannelMock.mockRejectedValue(new Error('realtime unavailable'));
    notificationFindManyMock.mockRejectedValue(new Error('db down'));

    const controller = new AbortController();
    const response = (await GET(streamRequest(controller.signal)))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();

    // 1回目の poll 失敗 → 初回警告
    vi.setSystemTime(new Date('2026-04-01T00:00:05.000Z'));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(notificationFindManyMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'notification stream poll failed',
      expect.objectContaining({
        event: 'notification_stream_poll_failed',
        consecutive_failures: 1,
        error_name: 'Error',
      }),
    );

    // ストリームは生存し、次の poll が再スケジュールされている(2回目も発火)
    vi.setSystemTime(new Date('2026-04-01T00:00:10.000Z'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(notificationFindManyMock).toHaveBeenCalledTimes(2);

    // ログ氾濫を避けるため、2回目の連続失敗では警告を増やさない
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.runOnlyPendingTimersAsync();
  });

  it('keeps a low-frequency safety poll when the user realtime channel is subscribed', async () => {
    const timeoutHandle = { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timeoutHandle);

    const controller = new AbortController();
    const response = (await GET(streamRequest(controller.signal)))!;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('reader is required');
    await reader.read();

    await Promise.resolve();
    await Promise.resolve();
    expect(notificationFindManyMock).not.toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);

    controller.abort();
    await Promise.resolve();
    setTimeoutSpy.mockRestore();
  });
});
