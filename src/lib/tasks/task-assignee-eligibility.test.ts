import type { MemberRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  canActorCreateTaskForAssignee,
  canActorManageTaskAssignments,
  evaluateTaskAssigneeMembershipsEligibility,
  evaluateTaskAssigneeRoleEligibility,
  listAssignableWorkRequestTypes,
  requiresDedicatedTaskAssignmentFlow,
} from './task-assignee-eligibility';

const ROLE_MATRIX = {
  owner: { visit: true, audit: true, general: true },
  admin: { visit: true, audit: true, general: true },
  pharmacist: { visit: true, audit: true, general: true },
  pharmacist_trainee: { visit: true, audit: false, general: true },
  clerk: { visit: false, audit: false, general: false },
  driver: { visit: false, audit: false, general: false },
  external_viewer: { visit: false, audit: false, general: false },
} as const satisfies Record<MemberRole, { visit: boolean; audit: boolean; general: boolean }>;

describe('task assignee eligibility', () => {
  it.each(['handoff_supervision_review', 'core.handoff_supervision_review'])(
    'requires the dedicated assignment flow for %s',
    (taskType) => {
      expect(requiresDedicatedTaskAssignmentFlow(taskType)).toBe(true);
    },
  );

  it('does not classify adjacent or unknown task types as dedicated assignment flows', () => {
    expect(requiresDedicatedTaskAssignmentFlow('handoff_confirmation')).toBe(false);
    expect(requiresDedicatedTaskAssignmentFlow('unknown_task_type')).toBe(false);
  });

  it.each(Object.entries(ROLE_MATRIX) as Array<[MemberRole, (typeof ROLE_MATRIX)[MemberRole]]>)(
    'enforces the work-request capability matrix for %s',
    (role, expected) => {
      expect({
        visit: evaluateTaskAssigneeRoleEligibility('staff_work_request_visit', role).eligible,
        audit: evaluateTaskAssigneeRoleEligibility('staff_work_request_audit', role).eligible,
        general: evaluateTaskAssigneeRoleEligibility('staff_work_request_general', role).eligible,
      }).toEqual(expected);
    },
  );

  it.each([
    ['staff_work_request_visit', 'core.staff_work_request_visit'],
    ['staff_work_request_audit', 'pharmacy.staff_work_request_audit'],
    ['staff_work_request_general', 'core.staff_work_request_general'],
  ])('applies the same rule to legacy %s and canonical %s', (legacyType, canonicalType) => {
    for (const role of Object.keys(ROLE_MATRIX) as MemberRole[]) {
      expect(evaluateTaskAssigneeRoleEligibility(legacyType, role)).toMatchObject({
        eligible: evaluateTaskAssigneeRoleEligibility(canonicalType, role).eligible,
        canonicalTaskType: canonicalType,
      });
    }
  });

  it('requires canVisit for registered task types without a stricter task-specific rule', () => {
    expect(
      evaluateTaskAssigneeRoleEligibility('patient_self_report_followup', 'pharmacist'),
    ).toEqual({
      eligible: true,
      canonicalTaskType: 'core.patient_self_report_followup',
      requiredPermission: 'canVisit',
    });
    expect(
      evaluateTaskAssigneeRoleEligibility('patient_self_report_followup', 'clerk'),
    ).toMatchObject({ eligible: false, requiredPermission: 'canVisit' });
  });

  it('fails closed for an unregistered task type', () => {
    expect(evaluateTaskAssigneeRoleEligibility('unknown_task_type', 'owner')).toEqual({
      eligible: false,
      canonicalTaskType: null,
      requiredPermission: 'canVisit',
    });
  });

  it('requires the individual audit capability for pharmacists while preserving admin bypass', () => {
    expect(
      evaluateTaskAssigneeMembershipsEligibility('staff_work_request_audit', [
        { role: 'pharmacist', canAuditDispense: false },
      ]),
    ).toMatchObject({ eligible: false, reason: 'missing_membership_capability' });
    expect(
      evaluateTaskAssigneeMembershipsEligibility('staff_work_request_audit', [
        { role: 'pharmacist', canAuditDispense: true },
      ]),
    ).toMatchObject({ eligible: true, reason: 'eligible' });
    expect(
      evaluateTaskAssigneeMembershipsEligibility('staff_work_request_audit', [
        { role: 'admin', canAuditDispense: false },
        { role: 'admin', canAuditDispense: true },
      ]),
    ).toMatchObject({ eligible: true, reason: 'eligible' });
  });

  it('fails closed for mixed roles and task-relevant capability ambiguity', () => {
    expect(
      evaluateTaskAssigneeMembershipsEligibility('staff_work_request_general', [
        { role: 'pharmacist', canAuditDispense: true },
        { role: 'external_viewer', canAuditDispense: false },
      ]),
    ).toMatchObject({ eligible: false, reason: 'ambiguous_memberships' });
    expect(
      evaluateTaskAssigneeMembershipsEligibility('staff_work_request_audit', [
        { role: 'pharmacist', canAuditDispense: true },
        { role: 'pharmacist', canAuditDispense: false },
      ]),
    ).toMatchObject({ eligible: false, reason: 'ambiguous_memberships' });
  });

  it('does not let audit-flag variance block non-audit work for one stable role', () => {
    expect(
      evaluateTaskAssigneeMembershipsEligibility('staff_work_request_visit', [
        { role: 'pharmacist', canAuditDispense: true },
        { role: 'pharmacist', canAuditDispense: false },
      ]),
    ).toMatchObject({ eligible: true, reason: 'eligible' });
  });

  it.each([
    ['owner', 'owner_1', 'staff_2', true],
    ['admin', 'admin_1', 'staff_2', true],
    ['pharmacist', 'pharmacist_1', 'pharmacist_1', true],
    ['pharmacist', 'pharmacist_1', 'staff_2', false],
    ['pharmacist_trainee', 'trainee_1', 'trainee_1', true],
    ['pharmacist_trainee', 'trainee_1', 'staff_2', false],
    ['clerk', 'clerk_1', 'clerk_1', false],
    ['driver', 'driver_1', 'driver_1', false],
  ] as const)(
    'enforces create delegation scope for %s',
    (role, actorUserId, assigneeUserId, expected) => {
      expect(
        canActorCreateTaskForAssignee(
          { userId: actorUserId, memberships: [{ role }] },
          assigneeUserId,
        ),
      ).toBe(expected);
    },
  );

  it('fails closed when actor roles are absent or mixed across memberships', () => {
    expect(
      canActorCreateTaskForAssignee({ userId: 'owner_1', memberships: [] }, 'pharmacist_1'),
    ).toBe(false);
    expect(
      canActorCreateTaskForAssignee(
        {
          userId: 'owner_1',
          memberships: [{ role: 'owner' }, { role: 'pharmacist' }],
        },
        'pharmacist_1',
      ),
    ).toBe(false);
    expect(
      canActorManageTaskAssignments({
        userId: 'owner_1',
        memberships: [{ role: 'owner' }, { role: 'pharmacist' }],
      }),
    ).toBe(false);
    expect(
      canActorManageTaskAssignments({
        userId: 'owner_1',
        memberships: [{ role: 'owner' }, { role: 'owner' }],
      }),
    ).toBe(true);
  });

  it('combines actor delegation scope and assignee capability for candidate projection', () => {
    expect(
      listAssignableWorkRequestTypes(
        { userId: 'owner_1', memberships: [{ role: 'owner' }] },
        {
          userId: 'trainee_1',
          memberships: [{ role: 'pharmacist_trainee', canAuditDispense: false }],
        },
      ),
    ).toEqual(['staff_work_request_visit', 'staff_work_request_general']);
    expect(
      listAssignableWorkRequestTypes(
        { userId: 'pharmacist_1', memberships: [{ role: 'pharmacist' }] },
        {
          userId: 'pharmacist_2',
          memberships: [{ role: 'pharmacist', canAuditDispense: true }],
        },
      ),
    ).toEqual([]);
    expect(
      listAssignableWorkRequestTypes(
        { userId: 'owner_1', memberships: [{ role: 'owner' }] },
        { userId: 'clerk_1', memberships: [{ role: 'clerk', canAuditDispense: false }] },
      ),
    ).toEqual([]);
  });
});
