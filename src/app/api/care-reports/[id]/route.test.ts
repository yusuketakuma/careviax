import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    careReport: { findFirst: vi.fn() },
  },
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return {
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('care-reports/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
  });

  it('rejects non-draft status updates outside the send workflow', async () => {
    const response = await PATCH(createRequest({ status: 'sent' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
  });

  it('rejects reverting a sent report back to draft', async () => {
    prismaMock.careReport.findFirst.mockResolvedValue({
      id: 'report_1',
      status: 'sent',
    });

    const response = await PATCH(createRequest({ status: 'draft' }), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
  });
});
