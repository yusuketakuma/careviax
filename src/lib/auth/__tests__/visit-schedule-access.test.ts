import { describe, expect, it } from 'vitest';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
  buildPatientAssignmentWhere,
  buildPersonalCareCaseAssignmentWhere,
  buildVisitRecordScheduleAssignmentWhere,
  buildVisitScheduleProposalAssignmentWhere,
  buildVisitScheduleProposalCaseAccessWhere,
  buildVisitScheduleAssignmentWhere,
  canAccessVisitScheduleAssignment,
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

  it('builds patient and care-case filters from the same assignment policy (scoped roles)', () => {
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
    expect(
      buildPatientAssignmentWhere({
        userId: 'user_1',
        role: 'driver',
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

  it('appends patient assignment filters without replacing existing predicates (scoped roles)', () => {
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

  it('leaves the base where untouched for org-wide roles in applyPatientAssignmentWhere', () => {
    const result = applyPatientAssignmentWhere(
      { org_id: 'org_1', cases: { some: { status: 'active' } } },
      { userId: 'user_1', role: 'pharmacist' },
    );
    expect(result).toEqual({ org_id: 'org_1', cases: { some: { status: 'active' } } });
  });
});
