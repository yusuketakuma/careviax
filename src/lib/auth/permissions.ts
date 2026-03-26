import { MemberRole } from '@prisma/client';
import { forbidden } from '@/lib/api/response';

type Permission = {
  canDispense: boolean;
  canAuditDispense: boolean;
  canSet: boolean;
  canAuditSet: boolean;
  canVisit: boolean;
  canReport: boolean;
  canViewDashboard: boolean;
  canAdmin: boolean;
};

export type PermissionKey = keyof Permission;

// Role-based permission matrix aligned with the 8-step pharmacy workflow
const ROLE_PERMISSIONS: Record<MemberRole, Permission> = {
  owner: {
    canDispense: true,
    canAuditDispense: true,
    canSet: true,
    canAuditSet: true,
    canVisit: true,
    canReport: true,
    canViewDashboard: true,
    canAdmin: true,
  },
  admin: {
    canDispense: true,
    canAuditDispense: true,
    canSet: true,
    canAuditSet: true,
    canVisit: true,
    canReport: true,
    canViewDashboard: true,
    canAdmin: true,
  },
  pharmacist: {
    canDispense: true,
    canAuditDispense: true,
    canSet: true,
    canAuditSet: true,
    canVisit: true,
    canReport: true,
    canViewDashboard: true,
    canAdmin: false,
  },
  pharmacist_trainee: {
    canDispense: true,
    canAuditDispense: false,
    canSet: true,
    canAuditSet: false,
    canVisit: true,
    canReport: true,
    canViewDashboard: true,
    canAdmin: false,
  },
  clerk: {
    canDispense: false,
    canAuditDispense: false,
    canSet: false,
    canAuditSet: false,
    canVisit: false,
    canReport: true,
    canViewDashboard: true,
    canAdmin: false,
  },
  driver: {
    canDispense: false,
    canAuditDispense: false,
    canSet: false,
    canAuditSet: false,
    canVisit: false,
    canReport: false,
    canViewDashboard: false,
    canAdmin: false,
  },
  external_viewer: {
    canDispense: false,
    canAuditDispense: false,
    canSet: false,
    canAuditSet: false,
    canVisit: false,
    canReport: false,
    canViewDashboard: false,
    canAdmin: false,
  },
};

export function hasPermission(role: MemberRole, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

export function forbiddenIfMissingPermission(
  role: MemberRole,
  permission: PermissionKey,
  message = '権限がありません'
) {
  return hasPermission(role, permission) ? null : forbidden(message);
}

export function requirePermission(role: MemberRole, permission: PermissionKey): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Permission denied: ${permission} for role ${role}`);
  }
}
