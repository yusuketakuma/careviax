import { MemberRole } from '@prisma/client';

type Permission = {
  canDispense: boolean;
  canAuditDispense: boolean;
  canSet: boolean;
  canAuditSet: boolean;
  canVisit: boolean;
  canReport: boolean;
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
    canAdmin: true,
  },
  admin: {
    canDispense: true,
    canAuditDispense: true,
    canSet: true,
    canAuditSet: true,
    canVisit: true,
    canReport: true,
    canAdmin: true,
  },
  pharmacist: {
    canDispense: true,
    canAuditDispense: true,
    canSet: true,
    canAuditSet: true,
    canVisit: true,
    canReport: true,
    canAdmin: false,
  },
  pharmacist_trainee: {
    canDispense: true,
    canAuditDispense: false,
    canSet: true,
    canAuditSet: false,
    canVisit: true,
    canReport: true,
    canAdmin: false,
  },
  clerk: {
    canDispense: false,
    canAuditDispense: false,
    canSet: false,
    canAuditSet: false,
    canVisit: false,
    canReport: true,
    canAdmin: false,
  },
  driver: {
    canDispense: false,
    canAuditDispense: false,
    canSet: false,
    canAuditSet: false,
    canVisit: false,
    canReport: false,
    canAdmin: false,
  },
  external_viewer: {
    canDispense: false,
    canAuditDispense: false,
    canSet: false,
    canAuditSet: false,
    canVisit: false,
    canReport: false,
    canAdmin: false,
  },
};

export function hasPermission(role: MemberRole, permission: keyof Permission): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

export function requirePermission(role: MemberRole, permission: keyof Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Permission denied: ${permission} for role ${role}`);
  }
}
