import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  managementPlanFindManyMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  managementPlanFindFirstMock,
  managementPlanCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  managementPlanCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    managementPlan: {
      findMany: managementPlanFindManyMock,
      findFirst: managementPlanFindFirstMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/management-plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    managementPlanFindManyMock.mockResolvedValue([
      { id: 'plan_1', case_id: 'case_1', title: '訪問薬剤管理指導計画書' },
    ]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    managementPlanFindFirstMock.mockResolvedValue({ version: 2 });
    managementPlanCreateMock.mockResolvedValue({
      id: 'plan_3',
      case_id: 'case_1',
      version: 3,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        managementPlan: {
          findFirst: managementPlanFindFirstMock,
          create: managementPlanCreateMock,
        },
      }),
    );
  });

  it('lists management plans filtered by case id', async () => {
    const response = (await GET({
      url: 'http://localhost/api/management-plans?case_id=case_1',
    } as NextRequest))!;

    expect(response.status).toBe(200);
    expect(managementPlanFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        case_: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
      orderBy: [{ updated_at: 'desc' }],
    });
  });

  it('denies management plan creation for an unassigned case before write', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST({
      json: async () => ({
        case_id: 'case_unassigned',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
      }),
    } as NextRequest))!;

    expect(response.status).toBe(404);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_unassigned',
        org_id: 'org_1',
        OR: [
          { primary_pharmacist_id: 'user_1' },
          { backup_pharmacist_id: 'user_1' },
          { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
        ],
      },
      select: {
        id: true,
      },
    });
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible or cross-case source plan before cloning', async () => {
    managementPlanFindFirstMock.mockResolvedValue(null);

    const response = (await POST({
      json: async () => ({
        case_id: 'case_1',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
        source_plan_id: 'plan_unassigned',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(404);
    expect(managementPlanFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_unassigned',
        org_id: 'org_1',
        case_id: 'case_1',
        case_: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
      select: { id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(managementPlanCreateMock).not.toHaveBeenCalled();
  });

  it('creates a new management plan with incremented version', async () => {
    const response = (await POST({
      json: async () => ({
        case_id: 'case_1',
        title: '訪問薬剤管理指導計画書',
        content: { summary: '内容' },
        next_review_date: '2026-04-30',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(managementPlanCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        version: 3,
        created_by: 'user_1',
      }),
    });
  });
});
