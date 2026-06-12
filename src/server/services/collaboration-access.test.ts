import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dispenseTaskFindFirstMock, visitRecordFindFirstMock, patientFindFirstMock } = vi.hoisted(
  () => ({
    dispenseTaskFindFirstMock: vi.fn(),
    visitRecordFindFirstMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
  }),
);

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseTask: { findFirst: dispenseTaskFindFirstMock },
    visitRecord: { findFirst: visitRecordFindFirstMock },
    patient: { findFirst: patientFindFirstMock },
  },
}));

import { buildCollaborationRoomName, canAccessCollaborationEntity } from './collaboration-access';

const pharmacistCtx = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist' as const,
};

describe('collaboration-access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds tenant-scoped room names', () => {
    expect(
      buildCollaborationRoomName({
        orgId: 'org_1',
        entityType: 'dispense_task',
        entityId: 'dt_1',
      }),
    ).toBe('org_1:dispense_task:dt_1');
  });

  it('checks dispense task access through medication-cycle assignment scope', async () => {
    dispenseTaskFindFirstMock.mockResolvedValue({ id: 'dt_1' });

    await expect(
      canAccessCollaborationEntity(pharmacistCtx, 'dispense_task', 'dt_1'),
    ).resolves.toBe(true);

    expect(dispenseTaskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'dt_1',
        org_id: 'org_1',
        cycle: {
          case_: {
            OR: [
              { primary_pharmacist_id: 'user_1' },
              { backup_pharmacist_id: 'user_1' },
              { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
            ],
          },
        },
      },
      select: { id: true },
    });
  });

  it('returns false for inaccessible dispense tasks', async () => {
    dispenseTaskFindFirstMock.mockResolvedValue(null);

    await expect(
      canAccessCollaborationEntity(pharmacistCtx, 'dispense_task', 'dt_unassigned'),
    ).resolves.toBe(false);
  });

  it('checks visit record access through schedule assignment scope', async () => {
    visitRecordFindFirstMock.mockResolvedValue({ id: 'vr_1' });

    await expect(canAccessCollaborationEntity(pharmacistCtx, 'visit_record', 'vr_1')).resolves.toBe(
      true,
    );

    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'vr_1',
        org_id: 'org_1',
        AND: [
          {
            schedule: {
              OR: [
                { pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
              ],
            },
          },
        ],
      },
      select: { id: true },
    });
  });

  it('checks patient access through case assignment scope (P1-13 presence)', async () => {
    patientFindFirstMock.mockResolvedValue({ id: 'pt_1' });

    await expect(canAccessCollaborationEntity(pharmacistCtx, 'patient', 'pt_1')).resolves.toBe(
      true,
    );

    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'pt_1',
        org_id: 'org_1',
        AND: [
          {
            cases: {
              some: {
                OR: [
                  { primary_pharmacist_id: 'user_1' },
                  { backup_pharmacist_id: 'user_1' },
                  { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                ],
              },
            },
          },
        ],
      },
      select: { id: true },
    });
  });

  it('returns false for inaccessible patients', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    await expect(
      canAccessCollaborationEntity(pharmacistCtx, 'patient', 'pt_unassigned'),
    ).resolves.toBe(false);
  });

  it('uses org-only patient lookup for owner/admin bypass roles', async () => {
    patientFindFirstMock.mockResolvedValue({ id: 'pt_1' });

    await expect(
      canAccessCollaborationEntity({ ...pharmacistCtx, role: 'owner' }, 'patient', 'pt_1'),
    ).resolves.toBe(true);

    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'pt_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
  });

  it('uses org-only lookup for owner/admin bypass roles', async () => {
    dispenseTaskFindFirstMock.mockResolvedValue({ id: 'dt_1' });

    await expect(
      canAccessCollaborationEntity({ ...pharmacistCtx, role: 'admin' }, 'dispense_task', 'dt_1'),
    ).resolves.toBe(true);

    expect(dispenseTaskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'dt_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
  });
});
