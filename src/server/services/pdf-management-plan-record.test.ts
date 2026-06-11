import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getManagementPlanRecord } from '@/server/services/pdf-management-plan-record';
import { PdfNotFoundError } from './pdf-errors';

const { managementPlanFindFirstMock } = vi.hoisted(() => ({
  managementPlanFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    managementPlan: {
      findFirst: managementPlanFindFirstMock,
    },
  },
}));

describe('getManagementPlanRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws a PDF-safe not-found error when the plan is unavailable', async () => {
    managementPlanFindFirstMock.mockResolvedValue(null);

    await expect(getManagementPlanRecord('org_1', 'plan_1')).rejects.toBeInstanceOf(
      PdfNotFoundError,
    );

    expect(managementPlanFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'plan_1', org_id: 'org_1' },
      select: expect.any(Object),
    });
  });

  it('applies case assignment scope and returns the normalized PDF record', async () => {
    const updatedAt = new Date(2026, 3, 1);
    const patient = {
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date(1940, 0, 1),
      gender: 'male',
    };
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      title: '訪問薬剤管理指導計画書',
      summary: null,
      status: 'approved',
      version: 2,
      effective_from: new Date(2026, 3, 1),
      next_review_date: null,
      approved_at: new Date(2026, 3, 2),
      updated_at: updatedAt,
      content: { goals: ['服薬継続'] },
      case_: {
        patient,
      },
    });

    await expect(
      getManagementPlanRecord('org_1', 'plan_1', {
        userId: 'pharmacist_1',
        role: 'pharmacist',
      }),
    ).resolves.toMatchObject({
      id: 'plan_1',
      title: '訪問薬剤管理指導計画書',
      status: 'approved',
      version: 2,
      content: { goals: ['服薬継続'] },
      patient,
    });

    expect(managementPlanFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        case_: {
          OR: [
            { primary_pharmacist_id: 'pharmacist_1' },
            { backup_pharmacist_id: 'pharmacist_1' },
            { visit_schedules: { some: { pharmacist_id: 'pharmacist_1' } } },
          ],
        },
      },
      select: {
        id: true,
        title: true,
        summary: true,
        status: true,
        version: true,
        effective_from: true,
        next_review_date: true,
        approved_at: true,
        updated_at: true,
        content: true,
        case_: {
          select: {
            patient: {
              select: {
                id: true,
                name: true,
                birth_date: true,
                gender: true,
              },
            },
          },
        },
      },
    });
  });
});
