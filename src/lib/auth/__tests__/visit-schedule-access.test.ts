import { describe, expect, it } from 'vitest';
import {
  buildVisitRecordScheduleAssignmentWhere,
  buildVisitScheduleAssignmentWhere,
  canAccessVisitScheduleAssignment,
} from '../visit-schedule-access';

describe('visit schedule assignment access', () => {
  const schedule = {
    pharmacist_id: 'pharmacist_1',
    case_: {
      primary_pharmacist_id: 'primary_1',
      backup_pharmacist_id: 'backup_1',
    },
  };

  it('allows assigned schedule, primary case, backup case, owner, and admin users', () => {
    expect(
      canAccessVisitScheduleAssignment({ userId: 'pharmacist_1', role: 'pharmacist' }, schedule),
    ).toBe(true);
    expect(
      canAccessVisitScheduleAssignment(
        { userId: 'primary_1', role: 'pharmacist_trainee' },
        schedule,
      ),
    ).toBe(true);
    expect(
      canAccessVisitScheduleAssignment({ userId: 'backup_1', role: 'pharmacist' }, schedule),
    ).toBe(true);
    expect(
      canAccessVisitScheduleAssignment({ userId: 'unassigned_1', role: 'admin' }, schedule),
    ).toBe(true);
    expect(
      canAccessVisitScheduleAssignment({ userId: 'unassigned_1', role: 'owner' }, schedule),
    ).toBe(true);
  });

  it('denies non-assigned pharmacist and pharmacist trainee users', () => {
    expect(
      canAccessVisitScheduleAssignment({ userId: 'unassigned_1', role: 'pharmacist' }, schedule),
    ).toBe(false);
    expect(
      canAccessVisitScheduleAssignment(
        { userId: 'unassigned_1', role: 'pharmacist_trainee' },
        schedule,
      ),
    ).toBe(false);
  });

  it('builds schedule and visit-record filters for non-admin users only', () => {
    expect(
      buildVisitScheduleAssignmentWhere({
        userId: 'user_1',
        role: 'pharmacist',
      }),
    ).toEqual({
      OR: [
        { pharmacist_id: 'user_1' },
        { case_: { primary_pharmacist_id: 'user_1' } },
        { case_: { backup_pharmacist_id: 'user_1' } },
      ],
    });
    expect(
      buildVisitRecordScheduleAssignmentWhere({
        userId: 'user_1',
        role: 'pharmacist',
      }),
    ).toEqual({
      schedule: {
        OR: [
          { pharmacist_id: 'user_1' },
          { case_: { primary_pharmacist_id: 'user_1' } },
          { case_: { backup_pharmacist_id: 'user_1' } },
        ],
      },
    });
    expect(
      buildVisitScheduleAssignmentWhere({
        userId: 'admin_1',
        role: 'admin',
      }),
    ).toBeNull();
  });
});
