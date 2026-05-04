import { describe, expect, it } from 'vitest';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
  buildPatientAssignmentWhere,
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

  it('denies all non-bypass roles when not assigned, including clerk/driver/external_viewer', () => {
    for (const role of ['clerk', 'driver', 'external_viewer'] as const) {
      expect(
        canAccessVisitScheduleAssignment({ userId: 'unassigned_1', role }, schedule),
      ).toBe(false);
    }
  });

  it('builds an assignment filter (not bypass) for every non-admin/non-owner role', () => {
    for (const role of [
      'pharmacist',
      'pharmacist_trainee',
      'clerk',
      'driver',
      'external_viewer',
    ] as const) {
      expect(buildCareCaseAssignmentWhere({ userId: 'user_1', role })).not.toBeNull();
      expect(buildVisitScheduleAssignmentWhere({ userId: 'user_1', role })).not.toBeNull();
      expect(buildPatientAssignmentWhere({ userId: 'user_1', role })).not.toBeNull();
    }
  });

  it('returns null (bypass) for owner and admin across every assignment-where helper', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(buildCareCaseAssignmentWhere({ userId: 'admin_1', role })).toBeNull();
      expect(buildVisitScheduleAssignmentWhere({ userId: 'admin_1', role })).toBeNull();
      expect(buildPatientAssignmentWhere({ userId: 'admin_1', role })).toBeNull();
      expect(buildVisitRecordScheduleAssignmentWhere({ userId: 'admin_1', role })).toBeNull();
    }
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

  it('builds patient and care-case filters from the same assignment policy', () => {
    expect(
      buildCareCaseAssignmentWhere({
        userId: 'user_1',
        role: 'pharmacist',
      }),
    ).toEqual({
      OR: [
        { primary_pharmacist_id: 'user_1' },
        { backup_pharmacist_id: 'user_1' },
        { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
      ],
    });
    expect(
      buildPatientAssignmentWhere({
        userId: 'user_1',
        role: 'pharmacist',
      }),
    ).toEqual({
      cases: {
        some: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
    });
  });

  it('appends patient assignment filters without replacing existing predicates', () => {
    expect(
      applyPatientAssignmentWhere(
        {
          org_id: 'org_1',
          cases: { some: { status: 'active' } },
        },
        {
          userId: 'user_1',
          role: 'pharmacist',
        },
      ),
    ).toEqual({
      org_id: 'org_1',
      cases: {
        some: {
          AND: [
            { status: 'active' },
            {
              OR: [
                { primary_pharmacist_id: 'user_1' },
                { backup_pharmacist_id: 'user_1' },
                { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
              ],
            },
          ],
        },
      },
    });
  });
});
