import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, txMock, notifyWorkflowMutationMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    prismaMock: {
      membership: { findFirst: vi.fn() },
      setBatch: { findMany: vi.fn() },
    },
    withOrgContextMock: vi.fn(),
    notifyWorkflowMutationMock: vi.fn(),
    txMock: {
      setPlan: { findFirst: vi.fn() },
      prescriptionLine: { findFirst: vi.fn() },
      setBatch: { findFirst: vi.fn(), create: vi.fn() },
      setBatchChangeLog: { create: vi.fn() },
    },
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

import { GET, POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/set-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createGetRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('set-batches POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
  });

  it('returns an empty batch list for trainee users when the plan belongs to an unassigned case', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist_trainee' });
    prismaMock.setBatch.findMany.mockResolvedValue([]);

    const response = await GET(createGetRequest('http://localhost/api/set-batches?plan_id=plan_1'), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: [] });
    expect(prismaMock.setBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          plan_id: 'plan_1',
          org_id: 'org_1',
          AND: [
            {
              plan: {
                cycle: {
                  case_: expect.objectContaining({
                    OR: expect.arrayContaining([
                      { primary_pharmacist_id: 'user_1' },
                      { backup_pharmacist_id: 'user_1' },
                      { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                    ]),
                  }),
                },
              },
            },
          ],
        },
      }),
    );
  });

  it('rejects lines that do not belong to the plan cycle', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      cycle: {
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
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
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });

  it('returns 404 for unassigned pharmacist batch creation before line lookup or writes', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    txMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(txMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        AND: [
          {
            cycle: {
              case_: expect.objectContaining({
                OR: expect.arrayContaining([
                  { primary_pharmacist_id: 'user_1' },
                  { backup_pharmacist_id: 'user_1' },
                  { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                ]),
              }),
            },
          },
        ],
      },
      select: expect.any(Object),
    });
    expect(txMock.prescriptionLine.findFirst).not.toHaveBeenCalled();
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate plan-line-slot-day combinations', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      cycle: {
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
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
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
  });

  it('broadcasts a workflow refresh after a batch is created', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      cycle: {
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
      intake: { cycle_id: 'cycle_1' },
    });
    txMock.setBatch.findFirst.mockResolvedValue(null);
    txMock.setBatch.create.mockResolvedValue({
      id: 'batch_1',
      plan_id: 'plan_1',
      line_id: 'line_1',
      slot: 'morning',
      day_number: 1,
      quantity: 1,
      carry_type: 'carry',
      packaging_method_snapshot: null,
      packaging_instructions_snapshot: null,
      packaging_instruction_tags_snapshot: [],
      line: { id: 'line_1', drug_name: 'Drug A' },
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
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_batches_create', plan_id: 'plan_1' },
    });
  });
});
