import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAuthContextMock,
  notificationFindManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
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

import { GET } from './route';

describe('/api/notifications/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    notificationFindManyMock.mockResolvedValue([]);
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
});
