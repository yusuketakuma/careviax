import { createShareScopeRegistry, type ShareScopeDefinition } from '@/core/share/scope-registry';
import type { PermissionKey } from '@/lib/auth/permissions';

export const EXTERNAL_ACCESS_SUPPORTED_SCOPE_KEYS = [
  'allergy_info',
  'medication_list',
  'visit_schedule',
  'care_reports',
] as const;

export const LEGACY_EXTERNAL_ACCESS_SCOPE_KEYS = ['self_report_history'] as const;

export const externalAccessShareScopeDefinitions = [
  {
    key: 'allergy_info',
    module: 'pharmacy',
    label: 'アレルギー情報',
    description: '登録済みのアレルギー情報を共有します。',
    requiredPermission: 'canVisit',
    requiresCaseBoundary: false,
    outputRisk: 'high',
  },
  {
    key: 'medication_list',
    module: 'pharmacy',
    label: '服薬中薬剤',
    description: '現在有効な服薬情報を共有します。',
    requiredPermission: 'canVisit',
    requiresCaseBoundary: false,
    outputRisk: 'high',
  },
  {
    key: 'visit_schedule',
    module: 'core',
    label: '訪問予定',
    description: '共有対象ケースに紐づく今後の訪問予定を共有します。',
    requiredPermission: 'canVisit',
    requiresCaseBoundary: true,
    outputRisk: 'medium',
  },
  {
    key: 'care_reports',
    module: 'core',
    label: 'ケアレポート',
    description: '共有対象ケースに紐づく送付済み・確認済み報告書の概要を共有します。',
    requiredPermission: 'canSendCareReport',
    requiresCaseBoundary: true,
    requiresReportBoundary: true,
    outputRisk: 'high',
  },
  {
    key: 'attachments',
    module: 'core',
    label: '添付ファイル',
    description: '共有対象に紐づく添付ファイルを共有します。',
    requiredPermission: 'canSendCareReport',
    requiresCaseBoundary: true,
    requiresReportBoundary: true,
    outputRisk: 'high',
  },
  {
    key: 'patient_summary',
    module: 'core',
    label: '患者サマリー',
    description: '外部共有用に最小化された患者サマリーを共有します。',
    requiredPermission: 'canVisit',
    requiresCaseBoundary: false,
    outputRisk: 'high',
  },
  {
    key: 'prescription_summary',
    module: 'pharmacy',
    label: '処方サマリー',
    description: '外部共有用に最小化された処方サマリーを共有します。',
    requiredPermission: 'canVisit',
    requiresCaseBoundary: true,
    outputRisk: 'high',
  },
  {
    key: 'residual_medications',
    module: 'pharmacy',
    label: '残薬情報',
    description: '外部共有用に最小化された残薬情報を共有します。',
    requiredPermission: 'canVisit',
    requiresCaseBoundary: true,
    outputRisk: 'high',
  },
  {
    key: 'self_report_history',
    module: 'core',
    label: 'セルフレポート履歴',
    description:
      'Legacy unsupported scope. Case-scoped data model が整うまで外部共有では公開しません。',
    requiredPermission: 'canSendCareReport',
    requiresCaseBoundary: true,
    outputRisk: 'high',
  },
] as const satisfies readonly ShareScopeDefinition<string, PermissionKey>[];

export const externalAccessShareScopeRegistry = createShareScopeRegistry(
  externalAccessShareScopeDefinitions,
);

export type ExternalAccessScopeKey = (typeof externalAccessShareScopeDefinitions)[number]['key'];
export type SupportedExternalAccessScopeKey = (typeof EXTERNAL_ACCESS_SUPPORTED_SCOPE_KEYS)[number];
export type LegacyExternalAccessScopeKey = (typeof LEGACY_EXTERNAL_ACCESS_SCOPE_KEYS)[number];

const supportedScopeKeySet = new Set<string>(EXTERNAL_ACCESS_SUPPORTED_SCOPE_KEYS);
const legacyScopeKeySet = new Set<string>(LEGACY_EXTERNAL_ACCESS_SCOPE_KEYS);

export const EXTERNAL_ACCESS_SCOPE_KEYS = externalAccessShareScopeRegistry.keys();

export const EXTERNAL_ACCESS_UNSUPPORTED_SCOPE_KEYS = EXTERNAL_ACCESS_SCOPE_KEYS.filter(
  (scopeKey) => !supportedScopeKeySet.has(scopeKey),
) as readonly Exclude<ExternalAccessScopeKey, SupportedExternalAccessScopeKey>[];

export const EXTERNAL_ACCESS_VISIBILITY_CASE_BOUNDARY_SCOPE_KEYS = externalAccessShareScopeRegistry
  .caseBoundaryKeys()
  .filter((scopeKey) => supportedScopeKeySet.has(scopeKey) || legacyScopeKeySet.has(scopeKey));

export const EXTERNAL_ACCESS_VISIBILITY_PATIENT_LEVEL_SCOPE_KEYS = externalAccessShareScopeRegistry
  .patientLevelKeys()
  .filter((scopeKey) => supportedScopeKeySet.has(scopeKey));

export function isExternalAccessScopeKey(value: string): value is ExternalAccessScopeKey {
  return externalAccessShareScopeRegistry.get(value) !== null;
}
