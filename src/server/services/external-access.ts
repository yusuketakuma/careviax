import { createHash, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import type { MemberRole } from '@prisma/client';
import { startOfDay } from 'date-fns';
import { decode, encode } from 'next-auth/jwt';
import { hasPermission, type PermissionKey } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';

type ExternalGrantRecord = {
  id: string;
  org_id: string;
  patient_id: string;
  otp_hash: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  scope: ExternalAccessScope;
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

const SENSITIVE_SCOPE_PERMISSIONS = {
  allergy_info: 'canVisit',
  medication_list: 'canVisit',
  care_reports: 'canSendCareReport',
  self_report_history: 'canSendCareReport',
  visit_schedule: 'canVisit',
} satisfies Partial<Record<ExternalAccessScopeKey, PermissionKey>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeExternalAccessScope(scope: unknown): ExternalAccessScopeCheckResult {
  if (!isRecord(scope)) {
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

  for (const [key, value] of Object.entries(scope)) {
    if (!EXTERNAL_ACCESS_SCOPE_KEY_SET.has(key)) {
      unknownKeys.push(key);
      continue;
    }

    if (typeof value !== 'boolean') {
      invalidKeys.push(key);
      continue;
    }

    normalized[key as ExternalAccessScopeKey] = value;
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

export function validateExternalAccessScopeForRole(
  scope: unknown,
  role: MemberRole,
): ExternalAccessScopeCheckResult {
  const normalized = normalizeExternalAccessScope(scope);
  if (!normalized.ok) return normalized;

  const deniedScopes = Object.entries(SENSITIVE_SCOPE_PERMISSIONS)
    .filter(([scopeKey]) => normalized.scope[scopeKey as ExternalAccessScopeKey] === true)
    .filter(([, permission]) => !hasPermission(role, permission))
    .map(([scopeKey]) => scopeKey);

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

const EXTERNAL_ACCESS_TOKEN_SALT = 'careviax-external-access';

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
  // EXTERNAL_ACCESS_TOKEN_SECRET is preferred; fall back to NEXTAUTH_SECRET for
  // environments that share the NextAuth secret (e.g. test/staging).
  const secret = process.env.EXTERNAL_ACCESS_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new MissingExternalAccessSecretError();
  }
  return secret;
}

function isExternalAccessTokenPayload(
  payload: Record<string, unknown>,
): payload is Record<string, unknown> & ExternalAccessTokenPayload {
  return (
    payload.purpose === 'external_access_grant' &&
    typeof payload.grant_id === 'string' &&
    typeof payload.org_id === 'string' &&
    typeof payload.patient_id === 'string'
  );
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
  let payload: Awaited<ReturnType<typeof decode>> | null = null;
  try {
    payload = await decode({
      token,
      secret: getExternalAccessSecret(),
      salt: EXTERNAL_ACCESS_TOKEN_SALT,
    });
  } catch {
    return null;
  }

  if (!payload || !isExternalAccessTokenPayload(payload as Record<string, unknown>)) {
    return null;
  }

  return payload as Record<string, unknown> & ExternalAccessTokenPayload;
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

  const scopeResult = normalizeExternalAccessScope(grant.scope);
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
  const scopeResult = normalizeExternalAccessScope(grant.scope);
  if (!scopeResult.ok) return null;
  const scope = scopeResult.scope;

  const patient = await prisma.patient.findFirst({
    where: { id: grant.patient_id, org_id: grant.org_id },
    select: {
      id: true,
      name: true,
      birth_date: true,
      gender: true,
      ...(scope.allergy_info === true ? { allergy_info: true } : {}),
    },
  });

  if (!patient) {
    return null;
  }

  const allergyInfoValue =
    scope.allergy_info === true
      ? ((patient as Record<string, unknown>).allergy_info ?? null)
      : null;
  const allergyInfo =
    allergyInfoValue == null
      ? null
      : typeof allergyInfoValue === 'string'
        ? allergyInfoValue
        : JSON.stringify(allergyInfoValue, null, 2);

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
    careReports = await prisma.careReport.findMany({
      where: {
        patient_id: grant.patient_id,
        org_id: grant.org_id,
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
  if ((scope as Record<string, unknown>).self_report_history === true) {
    selfReportHistory = await prisma.patientSelfReport.findMany({
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
    patient,
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
    scope,
    expires_at: grant.expires_at,
  };
}
