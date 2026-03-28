import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, txMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
  },
  withOrgContextMock: vi.fn(),
  txMock: {
    setPlan: { findFirst: vi.fn() },
    prescriptionLine: { findFirst: vi.fn() },
    setBatch: { findFirst: vi.fn(), create: vi.fn() },
  },
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

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('set-batches POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
  });

  it('rejects lines that do not belong to the plan cycle', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({ id: 'plan_1', cycle_id: 'cycle_1' });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      intake: { cycle_id: 'cycle_2' },
    });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });

  it('rejects duplicate plan-line-slot-day combinations', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({ id: 'plan_1', cycle_id: 'cycle_1' });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      intake: { cycle_id: 'cycle_1' },
    });
    txMock.setBatch.findFirst.mockResolvedValue({ id: 'batch_1' });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
  });
});
