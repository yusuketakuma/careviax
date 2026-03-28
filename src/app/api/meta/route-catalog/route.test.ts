import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { requireAuthContextMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

import { GET } from './route';

function createRequest() {
  return {
    headers: {
      get: () => 'org_1',
    },
  } as unknown as NextRequest;
}

describe('/api/meta/route-catalog GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
  });

  it('returns the route catalog for admins', async () => {
    const response = await GET(createRequest());
    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from route catalog GET');
    }

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          path: '/api/patients',
        }),
        expect.objectContaining({
          path: '/api/jobs',
        }),
        expect.objectContaining({
          path: '/api/files/presigned-upload',
        }),
      ]),
    });
  });
});
