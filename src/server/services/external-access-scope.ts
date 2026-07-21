import { Prisma, type MemberRole } from '@prisma/client';
import { hasPermission } from '@/lib/auth/permissions';
import { readJsonObject } from '@/lib/db/json';
import {
  EXTERNAL_ACCESS_SCOPE_KEYS,
  EXTERNAL_ACCESS_UNSUPPORTED_SCOPE_KEYS,
  EXTERNAL_ACCESS_VISIBILITY_CASE_BOUNDARY_SCOPE_KEYS,
  EXTERNAL_ACCESS_VISIBILITY_PATIENT_LEVEL_SCOPE_KEYS,
  externalAccessShareScopeRegistry,
  isExternalAccessScopeKey,
  type ExternalAccessScopeKey,
} from './external-access-scope-registry';

export type ExternalAccessScope = Partial<Record<ExternalAccessScopeKey, boolean>>;
export type StoredExternalAccessScope = ExternalAccessScope & {
  allowed_case_ids?: string[];
  allowed_report_ids?: string[];
};

type ExternalAccessScopeCheckResult =
  | {
      ok: true;
      scope: ExternalAccessScope;
    }
  | {
      ok: false;
      kind: 'validation' | 'permission';
      message: string;
      details?: unknown;
    };

const EXTERNAL_ACCESS_ALLOWED_CASE_IDS_KEY = 'allowed_case_ids';
const EXTERNAL_ACCESS_ALLOWED_REPORT_IDS_KEY = 'allowed_report_ids';
const EXTERNAL_ACCESS_STORED_ONLY_SCOPE_KEYS = new Set([
  EXTERNAL_ACCESS_ALLOWED_CASE_IDS_KEY,
  EXTERNAL_ACCESS_ALLOWED_REPORT_IDS_KEY,
]);

export function normalizeExternalAccessScope(scope: unknown): ExternalAccessScopeCheckResult {
  const scopeObject = readJsonObject(scope);
  if (!scopeObject) {
    return {
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { scope: ['共有範囲はオブジェクトで指定してください'] },
    };
  }

  const normalized: ExternalAccessScope = {};
  const unknownKeys: string[] = [];
  const invalidKeys: string[] = [];

  for (const [key, value] of Object.entries(scopeObject)) {
    if (!isExternalAccessScopeKey(key)) {
      unknownKeys.push(key);
      continue;
    }

    if (typeof value !== 'boolean') {
      invalidKeys.push(key);
      continue;
    }

    normalized[key] = value;
  }

  if (unknownKeys.length > 0 || invalidKeys.length > 0) {
    return {
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: {
        ...(unknownKeys.length > 0 ? { unknown_scope_keys: unknownKeys } : {}),
        ...(invalidKeys.length > 0 ? { invalid_scope_keys: invalidKeys } : {}),
      },
    };
  }

  if (!Object.values(normalized).some((enabled) => enabled === true)) {
    return {
      ok: false,
      kind: 'validation',
      message: '共有範囲を1つ以上指定してください',
      details: { scope: ['共有する情報を1つ以上選択してください'] },
    };
  }

  return { ok: true, scope: normalized };
}

function normalizeAllowedCaseIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item): item is string => typeof item === 'string' && item.trim().length > 0)) {
    return null;
  }
  return Array.from(new Set(value));
}

export function normalizeStoredExternalAccessScope(
  scope: unknown,
): ExternalAccessScopeCheckResult & { scope?: StoredExternalAccessScope } {
  const scopeObject = readJsonObject(scope);
  if (!scopeObject) {
    return {
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { scope: ['共有範囲はオブジェクトで指定してください'] },
    };
  }

  const publicScope = Object.fromEntries(
    Object.entries(scopeObject).filter(([key]) => !EXTERNAL_ACCESS_STORED_ONLY_SCOPE_KEYS.has(key)),
  );
  const normalized = normalizeExternalAccessScope(publicScope);
  if (!normalized.ok) return normalized;

  const rawAllowedCaseIds = scopeObject[EXTERNAL_ACCESS_ALLOWED_CASE_IDS_KEY];
  const rawAllowedReportIds = scopeObject[EXTERNAL_ACCESS_ALLOWED_REPORT_IDS_KEY];
  if (rawAllowedCaseIds === undefined && rawAllowedReportIds === undefined) return normalized;

  const allowedCaseIds = normalizeAllowedCaseIds(rawAllowedCaseIds);
  if (rawAllowedCaseIds !== undefined && !allowedCaseIds) {
    return {
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { allowed_case_ids: ['許可ケースIDの形式が不正です'] },
    };
  }

  const allowedReportIds = normalizeAllowedCaseIds(rawAllowedReportIds);
  if (rawAllowedReportIds !== undefined && !allowedReportIds) {
    return {
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { allowed_report_ids: ['許可報告書IDの形式が不正です'] },
    };
  }

  if (allowedReportIds && normalized.scope.care_reports !== true) {
    return {
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { allowed_report_ids: ['報告書共有が有効な場合のみ指定できます'] },
    };
  }

  return {
    ok: true,
    scope: {
      ...normalized.scope,
      ...(allowedCaseIds ? { allowed_case_ids: allowedCaseIds } : {}),
      ...(allowedReportIds ? { allowed_report_ids: allowedReportIds } : {}),
    },
  };
}

export function externalAccessScopeRequiresCaseBoundary(scope: ExternalAccessScope) {
  return EXTERNAL_ACCESS_VISIBILITY_CASE_BOUNDARY_SCOPE_KEYS.some(
    (scopeKey) => scope[scopeKey] === true,
  );
}

export function externalAccessGrantVisibleForCaseIds(scope: unknown, caseIds: string[]) {
  const normalized = normalizeStoredExternalAccessScope(scope);
  if (!normalized.ok) return false;
  if (!externalAccessScopeRequiresCaseBoundary(normalized.scope)) return true;

  const allowedCaseIds = normalized.scope.allowed_case_ids;
  if (!allowedCaseIds) return false;
  const visibleCaseIds = new Set(caseIds);
  return allowedCaseIds.some((caseId) => visibleCaseIds.has(caseId));
}

function externalAccessScopeEnabledWhere(
  scopeKey: ExternalAccessScopeKey,
): Prisma.ExternalAccessGrantWhereInput {
  return { scope: { path: [scopeKey], equals: true } };
}

export function buildExternalAccessGrantVisibilityWhere(
  caseIds: readonly string[] | undefined,
): Prisma.ExternalAccessGrantWhereInput {
  if (caseIds === undefined) return {};

  const caseBackedScopeIsEnabled: Prisma.ExternalAccessGrantWhereInput = {
    OR: EXTERNAL_ACCESS_VISIBILITY_CASE_BOUNDARY_SCOPE_KEYS.map((scopeKey) =>
      externalAccessScopeEnabledWhere(scopeKey),
    ),
  };
  const patientLevelOnlyScope: Prisma.ExternalAccessGrantWhereInput = {
    AND: [
      {
        OR: EXTERNAL_ACCESS_VISIBILITY_PATIENT_LEVEL_SCOPE_KEYS.map((scopeKey) =>
          externalAccessScopeEnabledWhere(scopeKey),
        ),
      },
      ...EXTERNAL_ACCESS_VISIBILITY_CASE_BOUNDARY_SCOPE_KEYS.map((scopeKey) => ({
        NOT: externalAccessScopeEnabledWhere(scopeKey),
      })),
    ],
  };
  const uniqueCaseIds = Array.from(new Set(caseIds.filter(Boolean))).sort();

  return {
    OR: [
      patientLevelOnlyScope,
      ...uniqueCaseIds.map(
        (caseId): Prisma.ExternalAccessGrantWhereInput => ({
          AND: [
            caseBackedScopeIsEnabled,
            {
              scope: {
                path: [EXTERNAL_ACCESS_ALLOWED_CASE_IDS_KEY],
                array_contains: [caseId],
              },
            },
          ],
        }),
      ),
    ],
  };
}

export function buildVisibleExternalAccessGrantWhere(args: {
  orgId: string;
  patientId: string;
  caseIds: readonly string[] | undefined;
}): Prisma.ExternalAccessGrantWhereInput {
  return {
    org_id: args.orgId,
    patient_id: args.patientId,
    revoked_at: null,
    ...buildExternalAccessGrantVisibilityWhere(args.caseIds),
  };
}

export function attachExternalAccessCaseBoundary(
  scope: ExternalAccessScope,
  allowedCaseIds: string[],
): StoredExternalAccessScope {
  return {
    ...scope,
    allowed_case_ids: Array.from(new Set(allowedCaseIds)),
  };
}

export function attachExternalAccessReportDocumentBoundary(
  scope: StoredExternalAccessScope,
  allowedReportIds: string[],
): StoredExternalAccessScope {
  return {
    ...scope,
    allowed_report_ids: Array.from(new Set(allowedReportIds)),
  };
}

export function toPublicExternalAccessScope(scope: unknown): ExternalAccessScope {
  const normalized = normalizeStoredExternalAccessScope(scope);
  if (!normalized.ok) return {};
  const publicScope = { ...normalized.scope };
  delete publicScope.allowed_case_ids;
  delete publicScope.allowed_report_ids;
  for (const scopeKey of EXTERNAL_ACCESS_UNSUPPORTED_SCOPE_KEYS) {
    delete publicScope[scopeKey];
  }
  return publicScope;
}

export function validateExternalAccessScopeForRole(
  scope: unknown,
  role: MemberRole,
): ExternalAccessScopeCheckResult {
  const normalized = normalizeExternalAccessScope(scope);
  if (!normalized.ok) return normalized;

  const unsupportedScopes = EXTERNAL_ACCESS_UNSUPPORTED_SCOPE_KEYS.filter(
    (scopeKey) => normalized.scope[scopeKey] === true,
  );
  if (unsupportedScopes.length > 0) {
    return {
      ok: false,
      kind: 'validation',
      message: 'この共有範囲は現在サポートされていません',
      details: { unsupported_scope_keys: unsupportedScopes },
    };
  }

  const deniedScopes = EXTERNAL_ACCESS_SCOPE_KEYS.filter(
    (scopeKey) => normalized.scope[scopeKey] === true,
  ).filter((scopeKey) => {
    const definition = externalAccessShareScopeRegistry.require(scopeKey);
    return !hasPermission(role, definition.requiredPermission);
  });

  if (deniedScopes.length > 0) {
    return {
      ok: false,
      kind: 'permission',
      message: 'この共有範囲を発行する権限がありません',
      details: { denied_scope_keys: deniedScopes },
    };
  }

  return normalized;
}
