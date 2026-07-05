import { describe, expect, it } from 'vitest';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
  buildPatientAssignmentWhere,
  buildPersonalCareCaseAssignmentWhere,
  buildPersonalPatientAssignmentWhere,
  buildVisitRecordScheduleAssignmentWhere,
  buildVisitScheduleProposalAssignmentWhere,
  buildVisitScheduleProposalCaseAccessWhere,
  buildVisitScheduleAssignmentWhere,
  buildVisitHandoffConfirmationWhere,
  canAccessVisitScheduleAssignment,
  canConfirmVisitHandoff,
  canManageVisitScheduleLifecycle,
  canOverrideVisitHandoffConfirmation,
  canRequestSupervisedVisitHandoffConfirmation,
  canWriteVisitRecordForSchedule,
  selectVisitHandoffConfirmationAssignee,
  selectVisitHandoffSupervisionAssignee,
} from '../visit-schedule-access';

// 新アクセスポリシー:
// owner/admin/pharmacist/pharmacist_trainee/clerk は組織内フルアクセス(担当割当スコープを撤廃)。
// driver/external_viewer のみ担当割当でスコープされる(実際にはダッシュボード権限を持たず
// これらの経路には到達しないが、純関数の分岐としてはスコープを生成する)。
const ORG_WIDE_ROLES = ['owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk'] as const;
const SCOPED_ROLES = ['driver', 'external_viewer'] as const;

describe('visit schedule assignment access', () => {
  const schedule = {
    pharmacist_id: 'pharmacist_1',
    case_: {
      primary_pharmacist_id: 'primary_1',
      backup_pharmacist_id: 'backup_1',
    },
  };

  it('grants org-wide access roles access regardless of assignment', () => {
    for (const role of ORG_WIDE_ROLES) {
      expect(canAccessVisitScheduleAssignment({ userId: 'unassigned_1', role }, schedule)).toBe(
        true,
      );
    }
  });

  it('requires direct clinical responsibility for handoff confirmation', () => {
    expect(canConfirmVisitHandoff({ userId: 'pharmacist_1', role: 'pharmacist' }, schedule)).toBe(
      true,
    );
    expect(canConfirmVisitHandoff({ userId: 'primary_1', role: 'pharmacist' }, schedule)).toBe(
      true,
    );
    expect(canConfirmVisitHandoff({ userId: 'backup_1', role: 'pharmacist' }, schedule)).toBe(true);
    expect(canConfirmVisitHandoff({ userId: 'unassigned_1', role: 'pharmacist' }, schedule)).toBe(
      false,
    );
    expect(
      canConfirmVisitHandoff({ userId: 'pharmacist_1', role: 'pharmacist_trainee' }, schedule),
    ).toBe(false);
    expect(canConfirmVisitHandoff({ userId: 'pharmacist_1', role: 'clerk' }, schedule)).toBe(false);
  });

  it('keeps org-wide access separate from trainee visit-record write responsibility', () => {
    expect(
      canWriteVisitRecordForSchedule({ userId: 'unassigned_1', role: 'owner' }, schedule),
    ).toBe(true);
    expect(
      canWriteVisitRecordForSchedule({ userId: 'unassigned_1', role: 'admin' }, schedule),
    ).toBe(true);
    expect(
      canWriteVisitRecordForSchedule({ userId: 'unassigned_1', role: 'pharmacist' }, schedule),
    ).toBe(true);
    expect(
      canWriteVisitRecordForSchedule(
        { userId: 'unassigned_1', role: 'pharmacist_trainee' },
        schedule,
      ),
    ).toBe(false);
    expect(
      canWriteVisitRecordForSchedule(
        { userId: 'pharmacist_1', role: 'pharmacist_trainee' },
        schedule,
      ),
    ).toBe(true);
    expect(
      canWriteVisitRecordForSchedule({ userId: 'primary_1', role: 'pharmacist_trainee' }, schedule),
    ).toBe(true);
    expect(
      canWriteVisitRecordForSchedule({ userId: 'backup_1', role: 'pharmacist_trainee' }, schedule),
    ).toBe(true);
    expect(
      canWriteVisitRecordForSchedule({ userId: 'pharmacist_1', role: 'clerk' }, schedule),
    ).toBe(false);
    expect(
      canWriteVisitRecordForSchedule({ userId: 'pharmacist_1', role: 'driver' }, schedule),
    ).toBe(false);
    expect(
      canWriteVisitRecordForSchedule({ userId: 'pharmacist_1', role: 'external_viewer' }, schedule),
    ).toBe(false);
  });

  it('limits visit-schedule lifecycle writes to final clinical operators', () => {
    expect(canManageVisitScheduleLifecycle({ role: 'owner' })).toBe(true);
    expect(canManageVisitScheduleLifecycle({ role: 'admin' })).toBe(true);
    expect(canManageVisitScheduleLifecycle({ role: 'pharmacist' })).toBe(true);
    expect(canManageVisitScheduleLifecycle({ role: 'pharmacist_trainee' })).toBe(false);
    expect(canManageVisitScheduleLifecycle({ role: 'clerk' })).toBe(false);
    expect(canManageVisitScheduleLifecycle({ role: 'driver' })).toBe(false);
    expect(canManageVisitScheduleLifecycle({ role: 'external_viewer' })).toBe(false);
  });

  it('allows assigned pharmacist trainees to request supervised handoff confirmation only', () => {
    expect(
      canRequestSupervisedVisitHandoffConfirmation(
        { userId: 'pharmacist_1', role: 'pharmacist_trainee' },
        schedule,
      ),
    ).toBe(true);
    expect(
      canRequestSupervisedVisitHandoffConfirmation(
        { userId: 'primary_1', role: 'pharmacist_trainee' },
        schedule,
      ),
    ).toBe(true);
    expect(
      canRequestSupervisedVisitHandoffConfirmation(
        { userId: 'unassigned_1', role: 'pharmacist_trainee' },
        schedule,
      ),
    ).toBe(false);
    expect(
      canRequestSupervisedVisitHandoffConfirmation(
        { userId: 'pharmacist_1', role: 'pharmacist' },
        schedule,
      ),
    ).toBe(false);
  });

  it('allows only owner and admin to use handoff confirmation override', () => {
    expect(canOverrideVisitHandoffConfirmation({ role: 'owner' })).toBe(true);
    expect(canOverrideVisitHandoffConfirmation({ role: 'admin' })).toBe(true);
    expect(canOverrideVisitHandoffConfirmation({ role: 'pharmacist' })).toBe(false);
    expect(canOverrideVisitHandoffConfirmation({ role: 'pharmacist_trainee' })).toBe(false);
    expect(canOverrideVisitHandoffConfirmation({ role: 'clerk' })).toBe(false);
  });

  it('builds a strict handoff confirmation write claim for allowed roles only', () => {
    expect(buildVisitHandoffConfirmationWhere({ userId: 'user_1', role: 'pharmacist' })).toEqual({
      schedule: {
        OR: [
          { pharmacist_id: 'user_1' },
          { case_: { primary_pharmacist_id: 'user_1' } },
          { case_: { backup_pharmacist_id: 'user_1' } },
        ],
      },
    });
    expect(
      buildVisitHandoffConfirmationWhere({ userId: 'user_1', role: 'pharmacist_trainee' }),
    ).toBeNull();
  });

  it('selects the visit handoff confirmation assignee from visit then case responsibility', () => {
    expect(selectVisitHandoffConfirmationAssignee(schedule)).toBe('pharmacist_1');
    expect(
      selectVisitHandoffConfirmationAssignee({
        pharmacist_id: null,
        case_: { primary_pharmacist_id: 'primary_1', backup_pharmacist_id: 'backup_1' },
      }),
    ).toBe('primary_1');
    expect(
      selectVisitHandoffConfirmationAssignee({
        pharmacist_id: null,
        case_: { primary_pharmacist_id: null, backup_pharmacist_id: 'backup_1' },
      }),
    ).toBe('backup_1');
  });

  it('selects a supervision assignee without assigning the trainee to supervise themselves', () => {
    expect(selectVisitHandoffSupervisionAssignee(schedule, 'pharmacist_1')).toBe('primary_1');
    expect(selectVisitHandoffSupervisionAssignee(schedule, 'primary_1')).toBe('pharmacist_1');
    expect(
      selectVisitHandoffSupervisionAssignee(
        {
          pharmacist_id: 'trainee_1',
          case_: { primary_pharmacist_id: 'trainee_1', backup_pharmacist_id: 'backup_1' },
        },
        'trainee_1',
      ),
    ).toBe('backup_1');
    expect(
      selectVisitHandoffSupervisionAssignee(
        {
          pharmacist_id: 'trainee_1',
          case_: { primary_pharmacist_id: null, backup_pharmacist_id: 'trainee_1' },
        },
        'trainee_1',
      ),
    ).toBeNull();
  });

  it('still scopes driver/external_viewer to their concrete assignment', () => {
    for (const role of SCOPED_ROLES) {
      expect(canAccessVisitScheduleAssignment({ userId: 'pharmacist_1', role }, schedule)).toBe(
        true,
      );
      expect(canAccessVisitScheduleAssignment({ userId: 'primary_1', role }, schedule)).toBe(true);
      expect(canAccessVisitScheduleAssignment({ userId: 'unassigned_1', role }, schedule)).toBe(
        false,
      );
    }
  });

  it('returns null (bypass) for every org-wide access role across each assignment-where helper', () => {
    for (const role of ORG_WIDE_ROLES) {
      expect(buildCareCaseAssignmentWhere({ userId: 'user_1', role })).toBeNull();
      expect(buildVisitScheduleAssignmentWhere({ userId: 'user_1', role })).toBeNull();
      expect(buildVisitScheduleProposalAssignmentWhere({ userId: 'user_1', role })).toBeNull();
      expect(buildVisitScheduleProposalCaseAccessWhere({ userId: 'user_1', role })).toBeNull();
      expect(buildPatientAssignmentWhere({ userId: 'user_1', role })).toBeNull();
      expect(buildVisitRecordScheduleAssignmentWhere({ userId: 'user_1', role })).toBeNull();
    }
  });

  it('builds an assignment filter for scoped roles (driver/external_viewer)', () => {
    for (const role of SCOPED_ROLES) {
      expect(buildCareCaseAssignmentWhere({ userId: 'user_1', role })).not.toBeNull();
      expect(buildVisitScheduleAssignmentWhere({ userId: 'user_1', role })).not.toBeNull();
      expect(buildVisitScheduleProposalAssignmentWhere({ userId: 'user_1', role })).not.toBeNull();
      expect(buildPatientAssignmentWhere({ userId: 'user_1', role })).not.toBeNull();
    }
  });

  it('builds schedule and visit-record filters for scoped roles only', () => {
    expect(
      buildVisitScheduleAssignmentWhere({
        userId: 'user_1',
        role: 'driver',
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
        role: 'driver',
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
        userId: 'pharmacist_1',
        role: 'pharmacist',
      }),
    ).toBeNull();
  });

  it('builds proposal filters from proposed pharmacist and case assignment policy (scoped roles)', () => {
    expect(
      buildVisitScheduleProposalAssignmentWhere({
        userId: 'user_1',
        role: 'driver',
      }),
    ).toEqual({
      OR: [
        { proposed_pharmacist_id: 'user_1' },
        { case_: { primary_pharmacist_id: 'user_1' } },
        { case_: { backup_pharmacist_id: 'user_1' } },
        { case_: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } },
      ],
    });
  });

  it('allows proposal case access through the proposed pharmacist before falling back to case assignment (scoped roles)', () => {
    expect(
      buildVisitScheduleProposalCaseAccessWhere(
        {
          userId: 'user_1',
          role: 'driver',
        },
        'user_1',
      ),
    ).toBeNull();

    expect(
      buildVisitScheduleProposalCaseAccessWhere(
        {
          userId: 'user_1',
          role: 'driver',
        },
        'other_user',
      ),
    ).toEqual({
      OR: [
        { primary_pharmacist_id: 'user_1' },
        { backup_pharmacist_id: 'user_1' },
        { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
      ],
    });
  });

  it('builds care-case filters from the existing case assignment policy (scoped roles)', () => {
    expect(
      buildCareCaseAssignmentWhere({
        userId: 'user_1',
        role: 'driver',
      }),
    ).toEqual({
      OR: [
        { primary_pharmacist_id: 'user_1' },
        { backup_pharmacist_id: 'user_1' },
        { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
      ],
    });
  });

  it('builds patient filters from Patient-root pharmacist/staff assignment columns (scoped roles)', () => {
    expect(
      buildPatientAssignmentWhere({
        userId: 'user_1',
        role: 'driver',
      }),
    ).toEqual({
      OR: [
        { primary_pharmacist_id: 'user_1' },
        { backup_pharmacist_id: 'user_1' },
        { primary_staff_id: 'user_1' },
        { backup_staff_id: 'user_1' },
        { cases: { some: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } } },
      ],
    });
  });

  it('buildPersonalCareCaseAssignmentWhere always returns the assignment filter, even for org-wide roles', () => {
    const expected = {
      OR: [
        { primary_pharmacist_id: 'user_1' },
        { backup_pharmacist_id: 'user_1' },
        { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
      ],
    };
    // ダッシュボードの個人作業キュー用: bypass 対象でも自分の担当に厳密に絞る。
    expect(buildPersonalCareCaseAssignmentWhere({ userId: 'user_1', role: 'pharmacist' })).toEqual(
      expected,
    );
    expect(buildPersonalCareCaseAssignmentWhere({ userId: 'user_1', role: 'owner' })).toEqual(
      expected,
    );
  });

  it('buildPersonalPatientAssignmentWhere always returns the Patient-root assignment filter, even for org-wide roles', () => {
    const expected = {
      OR: [
        { primary_pharmacist_id: 'user_1' },
        { backup_pharmacist_id: 'user_1' },
        { primary_staff_id: 'user_1' },
        { backup_staff_id: 'user_1' },
        { cases: { some: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } } },
      ],
    };
    expect(buildPersonalPatientAssignmentWhere({ userId: 'user_1', role: 'pharmacist' })).toEqual(
      expected,
    );
    expect(buildPersonalPatientAssignmentWhere({ userId: 'user_1', role: 'owner' })).toEqual(
      expected,
    );
  });

  it('appends patient assignment filters without replacing existing cases.some predicates', () => {
    expect(
      applyPatientAssignmentWhere(
        {
          org_id: 'org_1',
          cases: { some: { status: 'active' } },
        },
        {
          userId: 'user_1',
          role: 'driver',
        },
      ),
    ).toEqual({
      org_id: 'org_1',
      cases: { some: { status: 'active' } },
      AND: [
        {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { primary_staff_id: 'user_1' },
            { backup_staff_id: 'user_1' },
            { cases: { some: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } } },
          ],
        },
      ],
    });
  });

  it('preserves existing Patient AND predicates when applying assignment filters', () => {
    expect(
      applyPatientAssignmentWhere(
        {
          org_id: 'org_1',
          AND: [{ archived_at: null }, { name: { contains: '山田' } }],
        },
        {
          userId: 'user_1',
          role: 'driver',
        },
      ),
    ).toEqual({
      org_id: 'org_1',
      AND: [
        { archived_at: null },
        { name: { contains: '山田' } },
        {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { primary_staff_id: 'user_1' },
            { backup_staff_id: 'user_1' },
            { cases: { some: { visit_schedules: { some: { pharmacist_id: 'user_1' } } } } },
          ],
        },
      ],
    });
  });

  it('leaves the base where untouched for org-wide roles in applyPatientAssignmentWhere', () => {
    const result = applyPatientAssignmentWhere(
      { org_id: 'org_1', cases: { some: { status: 'active' } } },
      { userId: 'user_1', role: 'pharmacist' },
    );
    expect(result).toEqual({ org_id: 'org_1', cases: { some: { status: 'active' } } });
  });
});
