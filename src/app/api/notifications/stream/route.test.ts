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
    const text = new TextDecoder().decode(firstChunk.value);
    expect(text).toBe(': keepalive\n\n');
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
      })
    );

    const firstCall = notificationFindManyMock.mock.calls[0]?.[0];
    expect(firstCall?.where.created_at.lte.getTime()).toBeGreaterThan(
      firstCall?.where.created_at.gt.getTime()
    );

    controller.abort();
    await vi.runOnlyPendingTimersAsync();
  });
});
