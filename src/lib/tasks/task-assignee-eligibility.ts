import type { MemberRole } from '@prisma/client';
import { hasPermission, type PermissionKey } from '@/lib/auth/permission-matrix';
import { ADMIN_MEMBER_ROLES } from '@/lib/auth/member-roles';
import { canViewAllDashboardWork } from '@/lib/auth/visit-schedule-access';
import { getCanonicalTaskType } from '@/lib/tasks/task-registry';
import { WORK_REQUEST_TYPES, type WorkRequestType } from '@/lib/tasks/work-request-navigation';

export const TASK_WORKLOAD_MEMBER_ROLES = [
  'owner',
  'admin',
  'pharmacist',
  'pharmacist_trainee',
  'clerk',
  'driver',
] as const satisfies readonly MemberRole[];

export const TASK_WORKLOAD_DISPLAY_ROLES = [...TASK_WORKLOAD_MEMBER_ROLES, 'multiple'] as const;

export const TASK_ASSIGNEE_REJECTION_REASON = 'task_assignee_ineligible' as const;

export function buildTaskAssigneeRejectionDetails(message: string) {
  return {
    reason: TASK_ASSIGNEE_REJECTION_REASON,
    assigned_to: [message],
  } as const;
}

type TaskAssigneeRule = {
  requiredPermission: PermissionKey;
};

const DEFAULT_TASK_ASSIGNEE_RULE = {
  // /api/tasks GET and PATCH both require canVisit. Assigning a task to a role without this
  // capability creates a task that the assignee cannot read or update.
  requiredPermission: 'canVisit',
} as const satisfies TaskAssigneeRule;

const TASK_ASSIGNEE_RULE_BY_CANONICAL_TYPE: Readonly<Record<string, TaskAssigneeRule>> = {
  'pharmacy.staff_work_request_audit': {
    requiredPermission: 'canAuditDispense',
  },
};

export type TaskAssigneeRoleEligibility = {
  eligible: boolean;
  canonicalTaskType: string | null;
  requiredPermission: PermissionKey;
};

export type TaskAssigneeMembership = {
  role: MemberRole;
  canAuditDispense: boolean;
};

export type TaskAssignmentActor = {
  userId: string;
  memberships: readonly Pick<TaskAssigneeMembership, 'role'>[];
};

export type TaskAssigneeMembershipEligibility = TaskAssigneeRoleEligibility & {
  reason:
    | 'eligible'
    | 'no_active_membership'
    | 'ambiguous_memberships'
    | 'missing_role_permission'
    | 'missing_membership_capability';
};

const ADMIN_MEMBER_ROLE_SET = new Set<MemberRole>(ADMIN_MEMBER_ROLES);

export function evaluateTaskAssigneeRoleEligibility(
  taskType: string,
  assigneeRole: MemberRole,
): TaskAssigneeRoleEligibility {
  const canonicalTaskType = getCanonicalTaskType(taskType);
  const rule = canonicalTaskType
    ? (TASK_ASSIGNEE_RULE_BY_CANONICAL_TYPE[canonicalTaskType] ?? DEFAULT_TASK_ASSIGNEE_RULE)
    : DEFAULT_TASK_ASSIGNEE_RULE;

  return {
    eligible: canonicalTaskType !== null && hasPermission(assigneeRole, rule.requiredPermission),
    canonicalTaskType,
    requiredPermission: rule.requiredPermission,
  };
}

/**
 * Task has no site boundary, while Membership may have one row per site. A mixed
 * role or capability set would make eligibility depend on row order, so reject it
 * until the product defines an org-wide effective-membership policy.
 */
export function evaluateTaskAssigneeMembershipsEligibility(
  taskType: string,
  memberships: readonly TaskAssigneeMembership[],
): TaskAssigneeMembershipEligibility {
  const fallback = evaluateTaskAssigneeRoleEligibility(taskType, 'external_viewer');
  if (memberships.length === 0) {
    return { ...fallback, eligible: false, reason: 'no_active_membership' };
  }

  if (new Set(memberships.map((membership) => membership.role)).size !== 1) {
    return { ...fallback, eligible: false, reason: 'ambiguous_memberships' };
  }

  const membership = memberships[0];
  const roleEligibility = evaluateTaskAssigneeRoleEligibility(taskType, membership.role);
  if (!roleEligibility.eligible) {
    return { ...roleEligibility, eligible: false, reason: 'missing_role_permission' };
  }

  if (
    roleEligibility.requiredPermission === 'canAuditDispense' &&
    !ADMIN_MEMBER_ROLE_SET.has(membership.role) &&
    new Set(memberships.map((item) => item.canAuditDispense)).size !== 1
  ) {
    return { ...roleEligibility, eligible: false, reason: 'ambiguous_memberships' };
  }

  if (
    roleEligibility.requiredPermission === 'canAuditDispense' &&
    !ADMIN_MEMBER_ROLE_SET.has(membership.role) &&
    !membership.canAuditDispense
  ) {
    return { ...roleEligibility, eligible: false, reason: 'missing_membership_capability' };
  }

  return { ...roleEligibility, eligible: true, reason: 'eligible' };
}

function resolveStableActorRole(actor: TaskAssignmentActor): MemberRole | null {
  const roles = Array.from(new Set(actor.memberships.map((membership) => membership.role)));
  return roles.length === 1 ? roles[0] : null;
}

export function canActorManageTaskAssignments(actor: TaskAssignmentActor): boolean {
  const role = resolveStableActorRole(actor);
  return Boolean(role && hasPermission(role, 'canVisit') && canViewAllDashboardWork({ role }));
}

export function canActorCreateTaskForAssignee(
  actor: TaskAssignmentActor,
  assigneeUserId: string,
): boolean {
  const role = resolveStableActorRole(actor);
  if (!role || !hasPermission(role, 'canVisit')) return false;
  return canViewAllDashboardWork({ role }) || actor.userId === assigneeUserId;
}

export function listAssignableWorkRequestTypes(
  actor: TaskAssignmentActor,
  assignee: { userId: string; memberships: readonly TaskAssigneeMembership[] },
): WorkRequestType[] {
  if (!canActorCreateTaskForAssignee(actor, assignee.userId)) return [];

  return WORK_REQUEST_TYPES.filter(
    (taskType) =>
      evaluateTaskAssigneeMembershipsEligibility(taskType, assignee.memberships).eligible,
  );
}
