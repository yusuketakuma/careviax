import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  managementPlanFindFirstMock,
  managementPlanUpdateMock,
  managementPlanUpdateManyMock,
  withOrgContextMock,
  resolveManagementPlanReviewAlertMock,
  scheduleManagementPlanReviewAlertMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
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
    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'plan_1',
      },
    });
  });

  it('approves a draft plan and schedules a review alert', async () => {
    const response = (await PATCH({
      json: async () => ({
        action: 'approve',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

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
