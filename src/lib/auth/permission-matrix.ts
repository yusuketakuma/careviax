import type { MemberRole } from '@prisma/client';

/**
 * CorePermission: 職種を問わず共通の受け皿として定義されるケイパビリティ
 * （訪問・報告書・連携・ダッシュボード等）。ProfessionTypeEnum に nurse/physician
 * 等のロールを追加する際も、この共通セットをそのまま再利用できる想定。
 * 対応表は docs/design/core-naming-conventions.md §5 を参照。
 */
type CorePermission = {
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

/**
 * PharmacyPermission: 8ステップ調剤ワークフロー（監査を伴う二重チェック工程含む）
 * に固有の、薬局業務専用のケイパビリティ。
 */
type PharmacyPermission = {
  canDispense: boolean;
  canAuditDispense: boolean;
  canSet: boolean;
  canAuditSet: boolean;
};

// 既存 Permission は Core capability と Pharmacy 固有 capability を合成した型として再構成する。
// ROLE_PERMISSIONS の値は両方のキーを同時に持つ必要があるため、型演算子としては
// intersection（&）を用いて CorePermission と PharmacyPermission の capability セットを合成する。
type Permission = CorePermission & PharmacyPermission;

export type { CorePermission, PharmacyPermission };
export type PermissionKey = keyof Permission;

// Role-based permission matrix aligned with the 8-step pharmacy workflow.
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
