import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, txMock, notifyWorkflowMutationMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
  },
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  txMock: {
    setPlan: { findFirst: vi.fn() },
    prescriptionLine: { findFirst: vi.fn() },
    setBatch: { findFirst: vi.fn(), create: vi.fn() },
    setBatchChangeLog: { create: vi.fn() },
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

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
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
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
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
      { params: Promise.resolve({}) }
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
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_batches_create', plan_id: 'plan_1' },
    });
  });
});
