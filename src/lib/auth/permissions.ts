import { MemberRole } from '@prisma/client';
import { forbidden } from '@/lib/api/response';

type Permission = {
  canDispense: boolean;
  canAuditDispense: boolean;
  canSet: boolean;
  canAuditSet: boolean;
  canVisit: boolean;
  canReport: boolean;
  // canAuthorReport: 臨床報告書の「作成・編集・生成」など薬剤師の専門的記載を伴う書き込み。
  // canReport（閲覧 + 連携/事務系の書き込み）から分離し、事務(clerk)は参照は可能だが
  // 臨床報告書の authoring はできない、という新ポリシーを表現する。
  canAuthorReport: boolean;
  canSendCareReport: boolean;
  canManageBilling: boolean;
  canManagePatientSharing: boolean;
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
    canAuthorReport: true,
    canSendCareReport: true,
    canManageBilling: true,
    canManagePatientSharing: true,
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
    canAuthorReport: true,
    canSendCareReport: true,
    canManageBilling: true,
    canManagePatientSharing: true,
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
    canAuthorReport: true,
    canSendCareReport: true,
    canManageBilling: true,
    canManagePatientSharing: true,
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
    canAuthorReport: true,
    canSendCareReport: false,
    canManageBilling: false,
    canManagePatientSharing: false,
    canViewDashboard: true,
    canAdmin: false,
  },
  clerk: {
    canDispense: false,
    canAuditDispense: false,
    canSet: false,
    canAuditSet: false,
    canVisit: false,
    // clerk(事務)は参照と連携/事務系の書き込み(canReport)は可能だが、
    // 臨床報告書の作成・編集・生成(canAuthorReport)は薬剤師業務のため不可。
    canReport: true,
    canAuthorReport: false,
    canSendCareReport: false,
    canManageBilling: false,
    canManagePatientSharing: false,
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
    canAuthorReport: false,
    canSendCareReport: false,
    canManageBilling: false,
    canManagePatientSharing: false,
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
    canAuthorReport: false,
    canSendCareReport: false,
    canManageBilling: false,
    canManagePatientSharing: false,
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
  message = '権限がありません',
) {
  return hasPermission(role, permission) ? null : forbidden(message);
}

export function requirePermission(role: MemberRole, permission: PermissionKey): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Permission denied: ${permission} for role ${role}`);
  }
}
