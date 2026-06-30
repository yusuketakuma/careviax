import { createHash, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import type { MemberRole, Prisma } from '@prisma/client';
import { startOfDay } from 'date-fns';
import { decode, encode } from 'next-auth/jwt';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { hasPermission, type PermissionKey } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { buildPatientArchiveSummary } from '@/lib/patient/archive-summary';
import { maskContactValueForAudit } from '@/lib/privacy/contact-mask';

type ExternalGrantRecord = {
  id: string;
  org_id: string;
  patient_id: string;
  granted_to_name?: string;
  granted_to_contact?: string | null;
  otp_hash: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  scope: StoredExternalAccessScope;
};

export const EXTERNAL_ACCESS_SCOPE_KEYS = [
  'allergy_info',
  'medication_list',
  'visit_schedule',
  'care_reports',
  'self_report_history',
] as const;

export type ExternalAccessScopeKey = (typeof EXTERNAL_ACCESS_SCOPE_KEYS)[number];
export type ExternalAccessScope = Partial<Record<ExternalAccessScopeKey, boolean>>;
export type StoredExternalAccessScope = ExternalAccessScope & {
  allowed_case_ids?: string[];
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

const EXTERNAL_ACCESS_SCOPE_KEY_SET = new Set<string>(EXTERNAL_ACCESS_SCOPE_KEYS);
const EXTERNAL_ACCESS_ALLOWED_CASE_IDS_KEY = 'allowed_case_ids';
const CASE_BACKED_EXTERNAL_ACCESS_SCOPE_KEYS = [
  'visit_schedule',
  'care_reports',
  'self_report_history',
] as const satisfies ExternalAccessScopeKey[];
const PATIENT_LEVEL_EXTERNAL_ACCESS_SCOPE_KEYS = [
  'allergy_info',
  'medication_list',
] as const satisfies ExternalAccessScopeKey[];
const UNSUPPORTED_EXTERNAL_ACCESS_SCOPE_KEYS = [
  'self_report_history',
] as const satisfies ExternalAccessScopeKey[];

const SENSITIVE_SCOPE_PERMISSIONS = {
  allergy_info: 'canVisit',
  medication_list: 'canVisit',
  care_reports: 'canSendCareReport',
  self_report_history: 'canSendCareReport',
  visit_schedule: 'canVisit',
} satisfies Record<ExternalAccessScopeKey, PermissionKey>;

function isExternalAccessScopeKey(value: string): value is ExternalAccessScopeKey {
  return EXTERNAL_ACCESS_SCOPE_KEY_SET.has(value);
}

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
    Object.entries(scopeObject).filter(([key]) => key !== EXTERNAL_ACCESS_ALLOWED_CASE_IDS_KEY),
  );
  const normalized = normalizeExternalAccessScope(publicScope);
  if (!normalized.ok) return normalized;

  const rawAllowedCaseIds = scopeObject[EXTERNAL_ACCESS_ALLOWED_CASE_IDS_KEY];
  if (rawAllowedCaseIds === undefined) return normalized;

  const allowedCaseIds = normalizeAllowedCaseIds(rawAllowedCaseIds);
  if (!allowedCaseIds) {
    return {
      ok: false,
      kind: 'validation',
      message: '共有範囲が不正です',
      details: { allowed_case_ids: ['許可ケースIDの形式が不正です'] },
    };
  }

  return {
    ok: true,
    scope: {
      ...normalized.scope,
      allowed_case_ids: allowedCaseIds,
    },
  };
}

export function externalAccessScopeRequiresCaseBoundary(scope: ExternalAccessScope) {
  return CASE_BACKED_EXTERNAL_ACCESS_SCOPE_KEYS.some((scopeKey) => scope[scopeKey] === true);
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
    OR: CASE_BACKED_EXTERNAL_ACCESS_SCOPE_KEYS.map((scopeKey) =>
      externalAccessScopeEnabledWhere(scopeKey),
    ),
  };
  const patientLevelOnlyScope: Prisma.ExternalAccessGrantWhereInput = {
    AND: [
      {
        OR: PATIENT_LEVEL_EXTERNAL_ACCESS_SCOPE_KEYS.map((scopeKey) =>
          externalAccessScopeEnabledWhere(scopeKey),
        ),
      },
      ...CASE_BACKED_EXTERNAL_ACCESS_SCOPE_KEYS.map((scopeKey) => ({
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

export function toPublicExternalAccessScope(scope: unknown): ExternalAccessScope {
  const normalized = normalizeStoredExternalAccessScope(scope);
  if (!normalized.ok) return {};
  const publicScope = { ...normalized.scope };
  delete publicScope.allowed_case_ids;
  for (const scopeKey of UNSUPPORTED_EXTERNAL_ACCESS_SCOPE_KEYS) {
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

  const unsupportedScopes = UNSUPPORTED_EXTERNAL_ACCESS_SCOPE_KEYS.filter(
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
  ).filter((scopeKey) => !hasPermission(role, SENSITIVE_SCOPE_PERMISSIONS[scopeKey]));

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

export type ExternalAccessValidationResult =
  | {
      ok: true;
      grant: ExternalGrantRecord;
    }
  | {
      ok: false;
      kind: 'not_found' | 'validation';
      message: string;
    };

export function hashExternalAccessToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** @deprecated Legacy SHA-256 helper kept for migration/test compatibility. */
export async function hashExternalAccessOtp(otp: string) {
  return createHash('sha256').update(otp).digest('hex');
}

function isBcryptHash(value: string) {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

function isLegacySha256Hex(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

async function verifyExternalAccessOtp(otp: string, storedHash: string) {
  if (isBcryptHash(storedHash)) {
    return bcrypt.compare(otp, storedHash);
  }

  if (!isLegacySha256Hex(storedHash)) {
    return false;
  }

  const actual = Buffer.from(createHash('sha256').update(otp).digest('hex'), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const EXTERNAL_ACCESS_TOKEN_SALT = 'ph-os-external-access';

type ExternalAccessTokenPayload = {
  grant_id: string;
  org_id: string;
  patient_id: string;
  purpose: 'external_access_grant';
};

export class MissingExternalAccessSecretError extends Error {
  constructor() {
    super('External access token secret is not configured');
    this.name = 'MissingExternalAccessSecretError';
  }
}

function getExternalAccessSecret() {
  const dedicated = process.env.EXTERNAL_ACCESS_TOKEN_SECRET;
  if (dedicated) {
    return dedicated;
  }
  // Production must configure the dedicated secret: sharing NEXTAUTH_SECRET
  // would let a leaked NextAuth secret mint external-access tokens too.
  if (process.env.NODE_ENV !== 'production' && process.env.NEXTAUTH_SECRET) {
    return process.env.NEXTAUTH_SECRET;
  }
  throw new MissingExternalAccessSecretError();
}

function readRequiredTokenString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normalizeExternalAccessTokenPayload(payload: unknown): ExternalAccessTokenPayload | null {
  const payloadObject = readJsonObject(payload);
  if (!payloadObject) return null;
  if (payloadObject.purpose !== 'external_access_grant') return null;

  const grantId = readRequiredTokenString(payloadObject, 'grant_id');
  const orgId = readRequiredTokenString(payloadObject, 'org_id');
  const patientId = readRequiredTokenString(payloadObject, 'patient_id');
  if (!grantId || !orgId || !patientId) return null;

  return {
    grant_id: grantId,
    org_id: orgId,
    patient_id: patientId,
    purpose: 'external_access_grant',
  };
}

export async function issueExternalAccessToken(args: {
  grantId: string;
  orgId: string;
  patientId: string;
  expiresHours: number;
}) {
  return encode({
    secret: getExternalAccessSecret(),
    salt: EXTERNAL_ACCESS_TOKEN_SALT,
    maxAge: args.expiresHours * 60 * 60,
    token: {
      sub: args.grantId,
      grant_id: args.grantId,
      org_id: args.orgId,
      patient_id: args.patientId,
      purpose: 'external_access_grant',
    } satisfies ExternalAccessTokenPayload & { sub: string },
  });
}

async function decodeExternalAccessToken(token: string) {
  let secret: string;
  try {
    secret = getExternalAccessSecret();
  } catch {
    return null;
  }

  let payload: Awaited<ReturnType<typeof decode>> | null = null;
  try {
    payload = await decode({
      token,
      secret,
      salt: EXTERNAL_ACCESS_TOKEN_SALT,
    });
  } catch {
    return null;
  }

  return normalizeExternalAccessTokenPayload(payload);
}

export async function validateExternalAccessGrant(
  token: string,
  otp: string | null | undefined,
): Promise<ExternalAccessValidationResult> {
  if (!token || token.length < 8) {
    return {
      ok: false,
      kind: 'not_found',
      message: '共有リンクが無効です',
    };
  }

  const tokenPayload = await decodeExternalAccessToken(token);
  if (!tokenPayload) {
    return {
      ok: false,
      kind: 'not_found',
      message: '共有リンクが無効です',
    };
  }

  const grant = await prisma.externalAccessGrant.findUnique({
    where: { token_hash: hashExternalAccessToken(token) },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      granted_to_name: true,
      granted_to_contact: true,
      otp_hash: true,
      expires_at: true,
      revoked_at: true,
      scope: true,
    },
  });

  if (
    !grant ||
    grant.id !== tokenPayload.grant_id ||
    grant.org_id !== tokenPayload.org_id ||
    grant.patient_id !== tokenPayload.patient_id ||
    grant.revoked_at ||
    grant.expires_at < new Date()
  ) {
    return {
      ok: false,
      kind: 'not_found',
      message: '共有リンクが無効または期限切れです',
    };
  }

  const scopeResult = normalizeStoredExternalAccessScope(grant.scope);
  if (!scopeResult.ok) {
    return {
      ok: false,
      kind: 'validation',
      message: scopeResult.message,
    };
  }

  if (!grant.otp_hash) {
    return {
      ok: false,
      kind: 'validation',
      message: 'OTPが必要です',
    };
  }

  if (!otp) {
    return {
      ok: false,
      kind: 'validation',
      message: 'OTPが必要です',
    };
  }

  const isValid = await verifyExternalAccessOtp(otp, grant.otp_hash);
  if (!isValid) {
    return {
      ok: false,
      kind: 'validation',
      message: 'OTPが正しくありません',
    };
  }

  return { ok: true, grant: { ...grant, scope: scopeResult.scope } };
}

export async function markExternalAccessViewed(grantId: string) {
  await prisma.externalAccessGrant.update({
    where: { id: grantId },
    data: { accessed_at: new Date() },
  });
}

export async function recordExternalAccessViewAudit(args: {
  grant: ExternalGrantRecord;
  ipAddress?: string | null;
  userAgent?: string | null;
  viewedAt?: Date;
}) {
  const viewedAt = args.viewedAt ?? new Date();
  await createAuditLogEntry(
    prisma,
    buildExternalAccessViewAuditContext(args),
    buildExternalAccessViewAuditInput(args.grant, viewedAt),
  );
}

export async function recordExternalAccessViewed(args: {
  grant: ExternalGrantRecord;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const viewedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const markResult = await tx.externalAccessGrant.updateMany({
      where: {
        id: args.grant.id,
        org_id: args.grant.org_id,
      },
      data: { accessed_at: viewedAt },
    });
    if (markResult.count !== 1) {
      throw new Error('EXTERNAL_ACCESS_VIEW_MARK_FAILED');
    }
    await createAuditLogEntry(
      tx,
      buildExternalAccessViewAuditContext(args),
      buildExternalAccessViewAuditInput(args.grant, viewedAt),
    );
  });
}

function buildExternalAccessViewAuditContext(args: {
  grant: ExternalGrantRecord;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return {
    orgId: args.grant.org_id,
    userId: `external_access:${args.grant.id}`,
    ipAddress: args.ipAddress ?? undefined,
    userAgent: args.userAgent ?? undefined,
  };
}

function buildExternalAccessViewAuditInput(grant: ExternalGrantRecord, viewedAt: Date) {
  const publicScope = toPublicExternalAccessScope(grant.scope);
  return {
    action: 'external_access_payload_viewed',
    targetType: 'external_access_grant',
    targetId: grant.id,
    patientId: grant.patient_id,
    changes: {
      patient_id: grant.patient_id,
      viewed_at: viewedAt.toISOString(),
      granted_to_name: grant.granted_to_name ?? null,
      granted_to_contact_masked: maskContactValueForAudit(grant.granted_to_contact ?? null, {
        phoneLeadingDigits: 3,
      }),
      scope: publicScope,
      scope_keys: EXTERNAL_ACCESS_SCOPE_KEYS.filter((scopeKey) => publicScope[scopeKey] === true),
    },
  };
}

function formatShareDate(value: Date) {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(value);
}

function buildExternalSharedSummary(args: {
  patientName: string;
  allergyInfo: string | null;
  medicationProfiles: Array<{
    drug_name: string;
    dose: string | null;
    frequency: string | null;
  }> | null;
  visitSchedules: Array<{
    scheduled_date: Date;
  }> | null;
  careReports: Array<{
    report_type: string;
    created_at: Date;
  }> | null;
}) {
  const medicationCount = args.medicationProfiles?.length ?? 0;
  const medicationNames = (args.medicationProfiles ?? []).slice(0, 4).map((item) => item.drug_name);
  const nextVisitDate = args.visitSchedules?.[0]?.scheduled_date ?? null;
  const latestCareReport = args.careReports?.[0] ?? null;

  const headlineParts = [
    medicationCount > 0 ? `服薬中 ${medicationCount}剤` : null,
    nextVisitDate ? `次回訪問 ${formatShareDate(nextVisitDate)}` : null,
    latestCareReport ? `共有報告 ${args.careReports?.length ?? 0}件` : null,
  ].filter((value): value is string => Boolean(value));

  const bullets = [
    medicationCount > 0
      ? `主な処方薬: ${medicationNames.join(' / ')}`
      : args.medicationProfiles
        ? '服薬情報はまだ登録されていません。'
        : null,
    nextVisitDate ? `直近の訪問予定: ${formatShareDate(nextVisitDate)}` : null,
    latestCareReport
      ? `最新の共有報告: ${latestCareReport.report_type} (${formatShareDate(latestCareReport.created_at)})`
      : args.careReports
        ? '共有済み報告書はありません。'
        : null,
    args.allergyInfo ? 'アレルギー情報を共有しています。' : null,
  ].filter((value): value is string => Boolean(value));

  return {
    headline: headlineParts.join(' / ') || `${args.patientName}さんの共有情報を確認できます。`,
    bullets,
    key_medications: medicationNames,
    next_visit_date: nextVisitDate?.toISOString() ?? null,
  };
}

export async function buildExternalAccessPayload(grant: ExternalGrantRecord) {
  const scopeResult = normalizeStoredExternalAccessScope(grant.scope);
  if (!scopeResult.ok) return null;
  const scope = scopeResult.scope;
  if (
    externalAccessScopeRequiresCaseBoundary(scope) &&
    (!scope.allowed_case_ids || scope.allowed_case_ids.length === 0)
  ) {
    return null;
  }
  const publicScope = toPublicExternalAccessScope(scope);
  if (!Object.values(publicScope).some((enabled) => enabled === true)) {
    return null;
  }
  const allowedCaseIds = scope.allowed_case_ids ?? null;

  const patient = await prisma.patient.findFirst({
    where: { id: grant.patient_id, org_id: grant.org_id },
    select: {
      id: true,
      name: true,
      birth_date: true,
      gender: true,
      archived_at: true,
      ...(scope.allergy_info === true ? { allergy_info: true } : {}),
    },
  });

  if (!patient) {
    return null;
  }

  const allergyInfoValue =
    scope.allergy_info === true ? (readJsonObject(patient)?.allergy_info ?? null) : null;
  const allergyInfo =
    allergyInfoValue == null
      ? null
      : typeof allergyInfoValue === 'string'
        ? allergyInfoValue
        : JSON.stringify(allergyInfoValue, null, 2);
  const patientPayload = {
    id: patient.id,
    name: patient.name,
    birth_date: patient.birth_date,
    gender: patient.gender,
    archive: buildPatientArchiveSummary(patient.archived_at),
  };

  let medicationProfiles = null;
  if (scope.medication_list === true) {
    medicationProfiles = await prisma.medicationProfile.findMany({
      where: {
        patient_id: grant.patient_id,
        org_id: grant.org_id,
        is_current: true,
      },
      select: {
        id: true,
        drug_name: true,
        dose: true,
        frequency: true,
        start_date: true,
        end_date: true,
        is_current: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  let visitSchedules: Array<{
    id: string;
    scheduled_date: Date;
    time_window_start: Date | null;
    time_window_end: Date | null;
    schedule_status: string;
  }> | null = null;

  if (scope.visit_schedule === true) {
    const activeCases = await prisma.careCase.findMany({
      where: {
        patient_id: grant.patient_id,
        org_id: grant.org_id,
        status: 'active',
        ...(allowedCaseIds ? { id: { in: allowedCaseIds } } : {}),
      },
      select: { id: true },
    });

    const caseIds = activeCases.map((item) => item.id);
    visitSchedules =
      caseIds.length === 0
        ? []
        : await prisma.visitSchedule.findMany({
            where: {
              case_id: { in: caseIds },
              org_id: grant.org_id,
              scheduled_date: {
                gte: startOfDay(new Date()),
              },
            },
            select: {
              id: true,
              scheduled_date: true,
              time_window_start: true,
              time_window_end: true,
              schedule_status: true,
            },
            orderBy: { scheduled_date: 'asc' },
            take: 10,
          });
  }

  let careReports = null;
  if (scope.care_reports === true) {
    careReports =
      allowedCaseIds?.length === 0
        ? []
        : await prisma.careReport.findMany({
            where: {
              patient_id: grant.patient_id,
              org_id: grant.org_id,
              ...(allowedCaseIds ? { case_id: { in: allowedCaseIds } } : {}),
              status: { in: ['sent', 'confirmed'] },
            },
            select: {
              id: true,
              report_type: true,
              status: true,
              created_at: true,
            },
            orderBy: { created_at: 'desc' },
            take: 3,
          });
  }

  let selfReportHistory: Array<Record<string, unknown>> = [];
  if (scope.self_report_history === true) {
    selfReportHistory = allowedCaseIds
      ? []
      : await prisma.patientSelfReport.findMany({
          where: {
            patient_id: grant.patient_id,
            org_id: grant.org_id,
          },
          select: {
            id: true,
            reported_by_name: true,
            relation: true,
            category: true,
            subject: true,
            content: true,
            requested_callback: true,
            preferred_contact_time: true,
            status: true,
            created_at: true,
            triaged_at: true,
          },
          orderBy: { created_at: 'desc' },
          take: 8,
        });
  }

  return {
    patient: patientPayload,
    ...(allergyInfo !== null ? { allergy_info: allergyInfo } : {}),
    ...(medicationProfiles !== null ? { medication_profiles: medicationProfiles } : {}),
    ...(visitSchedules !== null ? { visit_schedules: visitSchedules } : {}),
    ...(careReports !== null ? { care_reports: careReports } : {}),
    self_report_history: selfReportHistory,
    shared_summary: buildExternalSharedSummary({
      patientName: patient.name,
      allergyInfo,
      medicationProfiles,
      visitSchedules,
      careReports,
    }),
    scope: publicScope,
    expires_at: grant.expires_at,
  };
}
