import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  proposalFindManyMock,
  proposalUpdateMock,
  auditLogCreateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  proposalUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
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

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-schedule-proposals/reorder', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/visit-schedule-proposals/reorder', {
    method: 'PATCH',
    body: '{"ordered_proposal_ids":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
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
      }),
    );
  });

  it('reorders proposals within the same batch', async () => {
    const response = (await PATCH(
      createRequest({
        ordered_proposal_ids: ['proposal_2', 'proposal_1'],
      }),
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
    expect(proposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { proposed_pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
                { case_: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it('rejects non-object reorder payloads before transaction side effects', async () => {
    const response = (await PATCH(createRequest([])))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON reorder payloads before transaction side effects', async () => {
    const response = (await PATCH(createMalformedJsonRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('denies unassigned reorder requests before update, audit, or notify side effects', async () => {
    proposalFindManyMock.mockResolvedValueOnce([]);

    const response = (await PATCH(
      createRequest({
        ordered_proposal_ids: ['proposal_1', 'proposal_2'],
      }),
    ))!;

    expect(response.status).toBe(404);
    expect(proposalUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
      }),
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
        confirmation_context: {
          source: 'proposal_detail_route_preview',
          date: '2026-04-03',
          pharmacist_id: 'pharmacist_1',
          travel_mode: 'DRIVE',
          target_count: 2,
          route_order_diff_count: 2,
        },
      }),
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
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'visit_schedule_proposals_reordered',
          changes: expect.objectContaining({
            confirmation_context: {
              source: 'proposal_detail_route_preview',
              date: '2026-04-03',
              pharmacist_id: 'pharmacist_1',
              travel_mode: 'DRIVE',
              target_count: 2,
              route_order_diff_count: 2,
            },
          }),
        }),
      }),
    );
  });
});
