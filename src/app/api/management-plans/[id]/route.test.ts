import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  managementPlanFindFirstMock,
  managementPlanUpdateMock,
  managementPlanUpdateManyMock,
  withOrgContextMock,
  resolveManagementPlanReviewAlertMock,
  scheduleManagementPlanReviewAlertMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  managementPlanUpdateMock: vi.fn(),
  managementPlanUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  resolveManagementPlanReviewAlertMock: vi.fn(),
  scheduleManagementPlanReviewAlertMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findMany: careCaseFindManyMock,
    },
    managementPlan: {
      findFirst: managementPlanFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  resolveManagementPlanReviewAlert: resolveManagementPlanReviewAlertMock,
  scheduleManagementPlanReviewAlert: scheduleManagementPlanReviewAlertMock,
}));

import { GET, PATCH } from './route';

function createGetRequest() {
  return new NextRequest('http://localhost/api/management-plans/plan_1');
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/management-plans/plan_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/management-plans/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      org_id: 'org_1',
      case_id: 'case_1',
      status: 'draft',
      next_review_date: new Date('2026-04-30T00:00:00.000Z'),
      case_: {
        patient_id: 'patient_1',
        primary_pharmacist_id: 'user_2',
      },
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    managementPlanUpdateMock.mockResolvedValue({
      id: 'plan_1',
      status: 'approved',
      next_review_date: new Date('2026-04-30T00:00:00.000Z'),
      case_id: 'case_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        managementPlan: {
          update: managementPlanUpdateMock,
          updateMany: managementPlanUpdateManyMock,
        },
      }),
    );
  });

  it('returns a management plan by id', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(managementPlanFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        case_: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'plan_1',
      },
    });
  });

  it('does not update an unassigned management plan', async () => {
    managementPlanFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        action: 'approve',
      }),
      {
        params: Promise.resolve({ id: 'plan_unassigned' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(managementPlanUpdateMock).not.toHaveBeenCalled();
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('updates draft plan content', async () => {
    const response = (await PATCH(
      createPatchRequest({
        action: 'update',
        title: '更新版計画書',
        content: { goals: ['服薬継続'], monitoring: ['副作用'] },
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(managementPlanUpdateMock).toHaveBeenCalledWith({
      where: { id: 'plan_1' },
      data: {
        title: '更新版計画書',
        content: { goals: ['服薬継続'], monitoring: ['副作用'] },
      },
    });
    expect(managementPlanUpdateManyMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('approves a draft plan and schedules a review alert', async () => {
    const response = (await PATCH(
      createPatchRequest({
        action: 'approve',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(managementPlanUpdateManyMock).toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        orgId: 'org_1',
        planId: 'plan_1',
        caseId: 'case_1',
        patientId: 'patient_1',
        assignedTo: 'user_2',
      })
    );
  });
});
