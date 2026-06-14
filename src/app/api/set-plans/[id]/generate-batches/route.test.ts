import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, txMock, notifyWorkflowMutationMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    prismaMock: {
      membership: { findFirst: vi.fn() },
      setPlan: { findFirst: vi.fn() },
      prescriptionIntake: { findMany: vi.fn() },
    },
    withOrgContextMock: vi.fn(),
    txMock: {
      setPlan: {
        update: vi.fn(),
      },
      setBatch: {
        count: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      setBatchChangeLog: {
        create: vi.fn(),
      },
    },
    notifyWorkflowMutationMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/set-plans/plan_1/generate-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/set-plans/plan_1/generate-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedRequest() {
  return new NextRequest('http://localhost/api/set-plans/plan_1/generate-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{"force":',
  });
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
      packaging_method_id: null,
      packaging_method_ref: null,
      updated_at: new Date('2026-03-01T00:00:00.000Z'),
      cycle: {
        overall_status: 'audited',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_1',
            drug_name: 'Drug',
            frequency: '朝夕',
            quantity: 2,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
          },
        ],
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
  });

  it('reuses existing batches instead of duplicating them when force is omitted', async () => {
    txMock.setBatch.count.mockResolvedValue(1);
    txMock.setBatch.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T00:00:00.000Z'),
    });
    txMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_1',
        day_number: 1,
        slot: 'morning',
        line_id: 'line_1',
        quantity: 1,
        carry_type: 'carry',
        packaging_method_snapshot: null,
        packaging_instructions_snapshot: null,
        packaging_instruction_tags_snapshot: [],
        line: { id: 'line_1', drug_name: 'Drug', dose: '1T', frequency: '朝夕', unit: '錠' },
      },
    ]);

    const response = await POST(createEmptyRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(payload.data.reused).toBe(true);
    expect(payload.data.count).toBe(1);
  });

  it('rejects malformed JSON before plan lookup or writes', async () => {
    const response = await POST(createMalformedRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object generation payloads before plan lookup or writes', async () => {
    const response = await POST(createRequest([]), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expect(prismaMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects generation when the cycle is not audit-ready', async () => {
    prismaMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-02T00:00:00.000Z'),
      set_method: 'custom',
      packaging_method_id: null,
      packaging_method_ref: null,
      updated_at: new Date('2026-03-01T00:00:00.000Z'),
      cycle: {
        overall_status: 'dispensing',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
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

  it('returns 404 for unassigned pharmacist generation before intake reads or writes', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    prismaMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await POST(createRequest({ force: true }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(404);
    expect(prismaMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
    expect(prismaMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
