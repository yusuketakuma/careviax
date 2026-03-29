import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, txMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    setPlan: { findFirst: vi.fn() },
    prescriptionIntake: { findMany: vi.fn() },
  },
  withOrgContextMock: vi.fn(),
  txMock: {
    setBatch: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
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

describe('set-plans/[id]/generate-batches POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-02T00:00:00.000Z'),
      set_method: 'custom',
      updated_at: new Date('2026-03-01T00:00:00.000Z'),
      cycle: {
        overall_status: 'audited',
      },
    });
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [{ id: 'line_1', drug_name: 'Drug', frequency: '朝夕', quantity: 2 }],
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
  });

  it('reuses existing batches instead of duplicating them when force is false', async () => {
    txMock.setBatch.count.mockResolvedValue(1);
    txMock.setBatch.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T00:00:00.000Z'),
    });
    txMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_1',
        day_number: 1,
        slot: 'morning',
        line: { id: 'line_1', drug_name: 'Drug', dose: '1T', frequency: '朝夕', unit: '錠' },
      },
    ]);

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(payload.data.reused).toBe(true);
    expect(payload.data.count).toBe(1);
  });

  it('rejects generation when the cycle is not audit-ready', async () => {
    prismaMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-02T00:00:00.000Z'),
      set_method: 'custom',
      updated_at: new Date('2026-03-01T00:00:00.000Z'),
      cycle: {
        overall_status: 'dispensing',
      },
    });

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '鑑査未承認のサイクルはセットできません',
    });
  });
});
