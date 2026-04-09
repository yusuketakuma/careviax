import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  proposalFindManyMock,
  proposalUpdateMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  proposalUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return {
    url: 'http://localhost/api/visit-schedule-proposals/reorder',
    method: 'PATCH',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/visit-schedule-proposals/reorder PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_1',
        case_id: 'case_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_1',
        finalized_schedule_id: null,
        proposal_status: 'proposed',
      },
      {
        id: 'proposal_2',
        case_id: 'case_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_1',
        finalized_schedule_id: null,
        proposal_status: 'patient_contact_pending',
      },
    ]);
    proposalUpdateMock.mockResolvedValue({});
    auditLogCreateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitScheduleProposal: {
          findMany: proposalFindManyMock,
          update: proposalUpdateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      })
    );
  });

  it('reorders proposals within the same batch', async () => {
    const response = (await PATCH(
      createRequest({
        ordered_proposal_ids: ['proposal_2', 'proposal_1'],
      })
    ))!;

    expect(response.status).toBe(200);
    expect(proposalUpdateMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'proposal_2' },
      data: { route_order: 1 },
    });
    expect(proposalUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'proposal_1' },
      data: { route_order: 2 },
    });
  });

  it('rejects proposals from different batches', async () => {
    proposalFindManyMock.mockResolvedValueOnce([
      {
        id: 'proposal_1',
        case_id: 'case_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_1',
        finalized_schedule_id: null,
        proposal_status: 'proposed',
      },
      {
        id: 'proposal_2',
        case_id: 'case_2',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_1',
        finalized_schedule_id: null,
        proposal_status: 'proposed',
      },
    ]);

    const response = (await PATCH(
      createRequest({
        ordered_proposal_ids: ['proposal_1', 'proposal_2'],
      })
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('accepts explicit route_order updates across different cases on the same pharmacist/day', async () => {
    proposalFindManyMock.mockResolvedValueOnce([
      {
        id: 'proposal_1',
        case_id: 'case_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_1',
        finalized_schedule_id: null,
        proposal_status: 'proposed',
      },
      {
        id: 'proposal_2',
        case_id: 'case_2',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_1',
        finalized_schedule_id: null,
        proposal_status: 'patient_contact_pending',
      },
    ]);

    const response = (await PATCH(
      createRequest({
        route_order_updates: [
          { proposal_id: 'proposal_1', route_order: 2 },
          { proposal_id: 'proposal_2', route_order: 4 },
        ],
      })
    ))!;

    expect(response.status).toBe(200);
    expect(proposalUpdateMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'proposal_1' },
      data: { route_order: 2 },
    });
    expect(proposalUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'proposal_2' },
      data: { route_order: 4 },
    });
  });
});
