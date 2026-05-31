import type { MemberRole } from '@prisma/client';

export const MANAGEABLE_MEMBER_ROLES = [
  'admin',
  'pharmacist',
  'pharmacist_trainee',
  'clerk',
  'driver',
  'external_viewer',
] as const satisfies readonly MemberRole[];

export const MEMBER_ROLES = [
  'owner',
  ...MANAGEABLE_MEMBER_ROLES,
] as const satisfies readonly MemberRole[];

export const ADMIN_MEMBER_ROLES = ['owner', 'admin'] as const satisfies readonly MemberRole[];

export const DISPENSE_AUDIT_FALLBACK_MEMBER_ROLES = [
  'admin',
  'pharmacist',
] as const satisfies readonly MemberRole[];

export type ManageableMemberRole = (typeof MANAGEABLE_MEMBER_ROLES)[number];

const MEMBER_ROLE_SET = new Set<string>(MEMBER_ROLES);

export function isMemberRole(role: unknown): role is MemberRole {
  return typeof role === 'string' && MEMBER_ROLE_SET.has(role);
}

export function membershipFlagsForRole(role: ManageableMemberRole | 'owner') {
  switch (role) {
    case 'owner':
    case 'admin':
      return {
        can_dispense: true,
        can_set: true,
        can_audit_dispense: true,
        can_audit_set: true,
      };
    case 'pharmacist':
      return {
        can_dispense: true,
        can_set: true,
        can_audit_dispense: false,
        can_audit_set: false,
      };
    case 'pharmacist_trainee':
      return {
        can_dispense: true,
        can_set: true,
        can_audit_dispense: false,
        can_audit_set: false,
      };
    case 'clerk':
    case 'driver':
    case 'external_viewer':
      return {
        can_dispense: false,
        can_set: false,
        can_audit_dispense: false,
        can_audit_set: false,
      };
  }
}

export function isOperationalMemberRole(role: MemberRole | string) {
  return (
    role === 'owner' ||
    role === 'admin' ||
    role === 'pharmacist' ||
    role === 'pharmacist_trainee'
  );
}

export function isCollaboratorRole(role: MemberRole | string) {
  return role === 'clerk' || role === 'driver' || role === 'external_viewer';
}

export function roleRequiresSite(role: MemberRole | string) {
  return role !== 'external_viewer';
}

export function memberRoleLabel(role: MemberRole | string) {
  switch (role) {
    case 'owner':
      return '責任者';
    case 'admin':
      return '管理者';
    case 'pharmacist':
      return '薬剤師';
    case 'pharmacist_trainee':
      return '研修薬剤師';
    case 'clerk':
      return '事務スタッフ';
    case 'driver':
      return '配送担当';
    case 'external_viewer':
      return '外部連携者';
    default:
      return role;
  }
}
