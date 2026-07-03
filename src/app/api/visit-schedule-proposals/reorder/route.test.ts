import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  authMock,
  membershipFindFirstMock,
  scheduleFindFirstMock,
  proposalFindManyMock,
  proposalFindFirstMock,
  proposalUpdateManyMock,
  auditLogCreateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  scheduleFindFirstMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  proposalFindFirstMock: vi.fn(),
  proposalUpdateManyMock: vi.fn(),
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

import { PATCH as rawPATCH } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const emptyRouteContext = { params: Promise.resolve({}) };
const PATCH = (req: NextRequest) => rawPATCH(req, emptyRouteContext);

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

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

function buildProposalFixture(overrides?: Record<string, unknown>) {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    proposed_date: new Date('2026-04-03T00:00:00.000Z'),
    proposed_pharmacist_id: 'pharmacist_1',
    finalized_schedule_id: null,
    proposal_status: 'proposed',
    ...overrides,
  };
}

describe('/api/visit-schedule-proposals/reorder PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    proposalFindManyMock.mockResolvedValue([
      buildProposalFixture(),
      buildProposalFixture({
        id: 'proposal_2',
        proposal_status: 'patient_contact_pending',
      }),
    ]);
    scheduleFindFirstMock.mockResolvedValue(null);
    proposalFindFirstMock.mockResolvedValue(null);
    proposalUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: scheduleFindFirstMock,
        },
        visitScheduleProposal: {
          findMany: proposalFindManyMock,
          findFirst: proposalFindFirstMock,
          updateMany: proposalUpdateManyMock,
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
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(proposalUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        org_id: 'org_1',
        id: 'proposal_2',
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        finalized_schedule_id: null,
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
      }),
      data: { route_order: 1 },
    });
    expect(proposalUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        org_id: 'org_1',
        id: 'proposal_1',
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        finalized_schedule_id: null,
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
      }),
      data: { route_order: 2 },
    });
    // 組織横断アクセスロール(pharmacist)は担当割当スコープが撤廃され、
    // 提案ルックアップは org_id + id の組織内検索のみ(AND 担当割当句なし)。
    expect(proposalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          id: { in: ['proposal_2', 'proposal_1'] },
        }),
      }),
    );
    expect(proposalFindManyMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('AND');
  });

  it('rejects non-object reorder payloads before transaction side effects', async () => {
    const response = (await PATCH(createRequest([])))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
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
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
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
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects proposals from different batches', async () => {
    proposalFindManyMock.mockResolvedValueOnce([
      buildProposalFixture(),
      buildProposalFixture({
        id: 'proposal_2',
        case_id: 'case_2',
      }),
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
      buildProposalFixture(),
      buildProposalFixture({
        id: 'proposal_2',
        case_id: 'case_2',
        proposal_status: 'patient_contact_pending',
      }),
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
    expect(proposalUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        id: 'proposal_1',
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
      }),
      data: { route_order: 2 },
    });
    expect(proposalUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        id: 'proposal_2',
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
      }),
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

  it('rejects stale expected route_order before proposal route writes', async () => {
    proposalFindManyMock.mockResolvedValueOnce([buildProposalFixture({ route_order: 2 })]);

    const response = (await PATCH(
      createRequest({
        route_order_updates: [
          { proposal_id: 'proposal_1', route_order: 1, expected_route_order: 1 },
        ],
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects arbitrary audit source text before transaction side effects', async () => {
    const response = (await PATCH(
      createRequest({
        route_order_updates: [{ proposal_id: 'proposal_1', route_order: 1 }],
        confirmation_context: {
          source: 'patient-name-or-free-text',
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects confirmation context that does not match the target route cell', async () => {
    proposalFindManyMock.mockResolvedValueOnce([buildProposalFixture()]);

    const response = (await PATCH(
      createRequest({
        route_order_updates: [{ proposal_id: 'proposal_1', route_order: 1 }],
        confirmation_context: {
          source: 'proposal_detail_route_preview',
          date: '2026-04-04',
          pharmacist_id: 'pharmacist_1',
          target_count: 1,
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '確認コンテキストが訪問候補の対象セルと一致しません',
    });
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate proposal targets before transaction side effects', async () => {
    const response = (await PATCH(
      createRequest({
        route_order_updates: [
          { proposal_id: 'proposal_1', route_order: 1 },
          { proposal_id: 'proposal_1', route_order: 2 },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同じ訪問候補を複数回指定できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('retries serializable proposal route conflicts and succeeds on retry', async () => {
    withOrgContextMock.mockImplementationOnce(async () => {
      throw buildSerializableConflictError();
    });
    proposalFindManyMock.mockResolvedValueOnce([buildProposalFixture()]);

    const response = (await PATCH(
      createRequest({
        route_order_updates: [{ proposal_id: 'proposal_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(proposalUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('returns conflict when serializable proposal route conflicts exceed retry limit', async () => {
    withOrgContextMock.mockImplementation(async () => {
      throw buildSerializableConflictError();
    });

    const response = (await PATCH(
      createRequest({
        route_order_updates: [{ proposal_id: 'proposal_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth plumbing fails before body parsing', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw auth proposal reorder patient 山田 花子 token secret'),
    );

    const response = (await PATCH(createRequest([])))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when route transaction fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw proposal reorder transaction patient 山田 花子 token secret route memo'),
    );

    const response = (await PATCH(
      createRequest({
        route_order_updates: [{ proposal_id: 'proposal_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw proposal');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when a guarded proposal write loses the race', async () => {
    proposalUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    proposalFindManyMock.mockResolvedValueOnce([buildProposalFixture()]);

    const response = (await PATCH(
      createRequest({
        route_order_updates: [{ proposal_id: 'proposal_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects existing open proposal route_order conflicts before writes', async () => {
    proposalFindFirstMock.mockResolvedValueOnce({ id: 'proposal_existing' });
    proposalFindManyMock.mockResolvedValueOnce([buildProposalFixture()]);

    const response = (await PATCH(
      createRequest({
        route_order_updates: [{ proposal_id: 'proposal_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'route_order は重複できません',
    });
    expect(scheduleFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-03'),
        route_order: 1,
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects existing confirmed schedule route_order conflicts before writes', async () => {
    scheduleFindFirstMock.mockResolvedValueOnce({ id: 'schedule_existing' });
    proposalFindManyMock.mockResolvedValueOnce([buildProposalFixture()]);

    const response = (await PATCH(
      createRequest({
        route_order_updates: [{ proposal_id: 'proposal_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'route_order は重複できません',
    });
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
