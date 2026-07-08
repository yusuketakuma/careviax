import { createHash, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma, type MemberRole } from '@prisma/client';
import { decode, encode } from 'next-auth/jwt';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { buildPatientArchiveSummary } from '@/lib/patient/archive-summary';
import { maskContactValueForAudit } from '@/lib/privacy/contact-mask';
import { todayUtcRange } from '@/lib/utils/date-boundary';
import {
  EXTERNAL_ACCESS_SCOPE_KEYS,
  EXTERNAL_ACCESS_UNSUPPORTED_SCOPE_KEYS,
  EXTERNAL_ACCESS_VISIBILITY_CASE_BOUNDARY_SCOPE_KEYS,
  EXTERNAL_ACCESS_VISIBILITY_PATIENT_LEVEL_SCOPE_KEYS,
  externalAccessShareScopeRegistry,
  isExternalAccessScopeKey,
  type ExternalAccessScopeKey,
} from './external-access-scope-registry';

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

const EXTERNAL_INBOUND_SUMMARY_WINDOW_DAYS = 30;
const EXTERNAL_INBOUND_SUMMARY_MAX_ROWS = 200;
const EXTERNAL_INBOUND_SUMMARY_RECENT_EVENT_LIMIT = 10;

const EXTERNAL_INBOUND_EVENT_PROCESSING_STATUSES = [
  'reviewed',
  'converted_to_task',
  'linked_to_workflow',
] as const;
const EXTERNAL_INBOUND_SIGNAL_REVIEW_STATUSES = ['accepted', 'record_only'] as const;
const EXTERNAL_INBOUND_SIGNAL_ACTION_STATUSES = [
  'linked_to_stock_event',
  'linked_to_task',
  'linked_to_schedule',
  'linked_to_report',
  'linked_to_visit_brief',
] as const;

const INBOUND_SOURCE_CHANNEL_LABELS: Record<string, string> = {
  mcs: 'MCS',
  phone: '電話',
  fax: 'FAX',
  email: 'メール',
  postal_mail: '郵送',
  in_person: '対面',
  manual: '手入力',
  unknown: '不明',
};

const INBOUND_SENDER_ROLE_LABELS: Record<string, string> = {
  nurse: '看護師',
  care_manager: 'ケアマネ',
  physician: '医師',
  dentist: '歯科医師',
  facility_staff: '施設職員',
  family: '家族',
  patient: '患者',
  pharmacist_external: '外部薬剤師',
  admin: '事務',
  unknown: '不明',
};

const INBOUND_EVENT_TYPE_LABELS: Record<string, string> = {
  medication_stock_report: '残薬報告',
  medication_usage_report: '服薬状況',
  medication_question: '薬剤相談',
  symptom_report: '症状報告',
  adverse_event_report: '副作用疑い',
  visit_schedule_request: '訪問日程相談',
  refill_request: '補充依頼',
  care_coordination: '連携事項',
  urgent_contact: '至急連絡',
  general_note: '一般連絡',
};

const INBOUND_SIGNAL_DOMAIN_LABELS: Record<string, string> = {
  medication_stock: '残薬',
  medication_safety: '薬剤安全',
  adherence: '服薬',
  symptom: '症状',
  schedule: '日程',
  report: '報告',
  refill_request: '補充',
  task: 'タスク',
  urgent: '至急',
  other: 'その他',
};

const INBOUND_SIGNAL_TYPE_LABELS: Record<string, string> = {
  observed_quantity: '数量報告',
  usage_delta: '使用量変化',
  usage_frequency: '使用頻度',
  low_stock_text: '残薬不足',
  refill_request: '補充希望',
  medication_name_unresolved: '薬剤未紐づけ',
  adherence_issue: '服薬課題',
  side_effect_suspected: '副作用疑い',
  safety_concern: '安全確認',
  schedule_change_request: '日程変更希望',
  visit_request: '訪問希望',
  report_inclusion_candidate: '報告書候補',
  task_request: 'タスク依頼',
  urgent_review_required: '至急確認',
  unknown: '不明',
};

function labelFromMap(map: Record<string, string>, key: string) {
  return map[key] ?? key;
}

function incrementCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function toCountRows(
  counts: Map<string, number>,
  keyName: string,
  labelMap: Record<string, string>,
) {
  return Array.from(counts.entries())
    .sort(
      ([leftKey, leftCount], [rightKey, rightCount]) =>
        rightCount - leftCount || leftKey.localeCompare(rightKey),
    )
    .map(([key, count]) => ({
      [keyName]: key,
      label: labelFromMap(labelMap, key),
      count,
    }));
}

function toUniqueLabelRows(
  values: readonly string[],
  keyName: string,
  labelMap: Record<string, string>,
) {
  return Array.from(new Set(values))
    .sort()
    .map((key) => ({
      [keyName]: key,
      label: labelFromMap(labelMap, key),
    }));
}

const inboundCommunicationExternalSummaryEventSelect =
  Prisma.validator<Prisma.InboundCommunicationEventSelect>()({
    received_at: true,
    source_channel: true,
    sender_role: true,
    event_type: true,
    has_medication_stock_signal: true,
    has_patient_safety_signal: true,
    has_schedule_signal: true,
    has_report_signal: true,
    signals: {
      where: {
        review_status: { in: [...EXTERNAL_INBOUND_SIGNAL_REVIEW_STATUSES] },
        reviewed_at: { not: null },
      },
      select: {
        signal_domain: true,
        signal_type: true,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 20,
    },
  });

const inboundCommunicationExternalSummarySignalSelect =
  Prisma.validator<Prisma.InboundCommunicationSignalSelect>()({
    signal_domain: true,
    signal_type: true,
  });

async function buildInboundCommunicationExternalSummary(args: {
  grant: ExternalGrantRecord;
  allowedCaseIds: readonly string[];
}) {
  if (args.allowedCaseIds.length === 0) return null;

  const now = new Date();
  const windowFrom = new Date(
    now.getTime() - EXTERNAL_INBOUND_SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const allowedCaseIds = [...args.allowedCaseIds];
  const sharedInboundEventWhere = {
    org_id: args.grant.org_id,
    patient_id: args.grant.patient_id,
    case_id: { in: allowedCaseIds },
    reviewed_at: { not: null },
  } satisfies Prisma.InboundCommunicationEventWhereInput;
  const sharedInboundSignalWhere = {
    org_id: args.grant.org_id,
    patient_id: args.grant.patient_id,
    case_id: { in: allowedCaseIds },
    reviewed_at: { not: null },
  } satisfies Prisma.InboundCommunicationSignalWhereInput;

  const eventRows = await prisma.inboundCommunicationEvent.findMany({
    where: {
      ...sharedInboundEventWhere,
      direction: 'inbound',
      received_at: {
        gte: windowFrom,
        lte: now,
      },
      processing_status: { in: [...EXTERNAL_INBOUND_EVENT_PROCESSING_STATUSES] },
    },
    select: inboundCommunicationExternalSummaryEventSelect,
    orderBy: [{ received_at: 'desc' }],
    take: EXTERNAL_INBOUND_SUMMARY_MAX_ROWS,
  });

  const signalRows = await prisma.inboundCommunicationSignal.findMany({
    where: {
      ...sharedInboundSignalWhere,
      created_at: {
        gte: windowFrom,
        lte: now,
      },
      review_status: { in: [...EXTERNAL_INBOUND_SIGNAL_REVIEW_STATUSES] },
      action_status: { in: [...EXTERNAL_INBOUND_SIGNAL_ACTION_STATUSES] },
      inbound_event: {
        ...sharedInboundEventWhere,
        direction: 'inbound',
        received_at: {
          gte: windowFrom,
          lte: now,
        },
        processing_status: { in: [...EXTERNAL_INBOUND_EVENT_PROCESSING_STATUSES] },
      },
    },
    select: inboundCommunicationExternalSummarySignalSelect,
    orderBy: [{ created_at: 'desc' }],
    take: EXTERNAL_INBOUND_SUMMARY_MAX_ROWS,
  });

  const eventTypeCounts = new Map<string, number>();
  const sourceChannelCounts = new Map<string, number>();
  let safetyEventCount = 0;
  let medicationStockEventCount = 0;
  let scheduleEventCount = 0;
  let reportEventCount = 0;

  for (const event of eventRows) {
    incrementCount(eventTypeCounts, event.event_type);
    incrementCount(sourceChannelCounts, event.source_channel);
    if (event.has_patient_safety_signal) safetyEventCount += 1;
    if (event.has_medication_stock_signal) medicationStockEventCount += 1;
    if (event.has_schedule_signal) scheduleEventCount += 1;
    if (event.has_report_signal) reportEventCount += 1;
  }

  const signalDomainCounts = new Map<string, number>();
  const signalTypeCounts = new Map<string, number>();
  let urgentSignalCount = 0;

  for (const signal of signalRows) {
    incrementCount(signalDomainCounts, signal.signal_domain);
    incrementCount(signalTypeCounts, signal.signal_type);
    if (signal.signal_domain === 'urgent' || signal.signal_type === 'urgent_review_required') {
      urgentSignalCount += 1;
    }
  }

  return {
    version: 1,
    window: {
      from: windowFrom.toISOString(),
      to: now.toISOString(),
      days: EXTERNAL_INBOUND_SUMMARY_WINDOW_DAYS,
    },
    totals: {
      event_count: eventRows.length,
      signal_count: signalRows.length,
      safety_event_count: safetyEventCount,
      medication_stock_event_count: medicationStockEventCount,
      schedule_event_count: scheduleEventCount,
      report_event_count: reportEventCount,
      urgent_signal_count: urgentSignalCount,
      truncated:
        eventRows.length >= EXTERNAL_INBOUND_SUMMARY_MAX_ROWS ||
        signalRows.length >= EXTERNAL_INBOUND_SUMMARY_MAX_ROWS,
    },
    latest_received_at: eventRows[0]?.received_at.toISOString() ?? null,
    event_type_counts: toCountRows(eventTypeCounts, 'event_type', INBOUND_EVENT_TYPE_LABELS),
    signal_domain_counts: toCountRows(
      signalDomainCounts,
      'signal_domain',
      INBOUND_SIGNAL_DOMAIN_LABELS,
    ),
    signal_type_counts: toCountRows(signalTypeCounts, 'signal_type', INBOUND_SIGNAL_TYPE_LABELS),
    source_channel_counts: toCountRows(
      sourceChannelCounts,
      'source_channel',
      INBOUND_SOURCE_CHANNEL_LABELS,
    ),
    recent_events: eventRows.slice(0, EXTERNAL_INBOUND_SUMMARY_RECENT_EVENT_LIMIT).map((event) => ({
      received_at: event.received_at.toISOString(),
      event_type: event.event_type,
      event_type_label: labelFromMap(INBOUND_EVENT_TYPE_LABELS, event.event_type),
      source_channel: event.source_channel,
      source_channel_label: labelFromMap(INBOUND_SOURCE_CHANNEL_LABELS, event.source_channel),
      sender_role: event.sender_role,
      sender_role_label: labelFromMap(INBOUND_SENDER_ROLE_LABELS, event.sender_role),
      flags: {
        medication_stock: event.has_medication_stock_signal,
        patient_safety: event.has_patient_safety_signal,
        schedule: event.has_schedule_signal,
        report: event.has_report_signal,
      },
      signal_domains: toUniqueLabelRows(
        event.signals.map((signal) => signal.signal_domain),
        'signal_domain',
        INBOUND_SIGNAL_DOMAIN_LABELS,
      ),
      signal_types: toUniqueLabelRows(
        event.signals.map((signal) => signal.signal_type),
        'signal_type',
        INBOUND_SIGNAL_TYPE_LABELS,
      ),
    })),
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
  const allowedReportIds = scope.allowed_report_ids ?? null;

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
                gte: todayUtcRange().gte,
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
      allowedCaseIds?.length === 0 || allowedReportIds?.length === 0
        ? []
        : await prisma.careReport.findMany({
            where: {
              ...(allowedReportIds ? { id: { in: allowedReportIds } } : {}),
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

  let inboundCommunicationSummary = null;
  if (scope.inbound_communication_summary === true) {
    inboundCommunicationSummary =
      allowedCaseIds?.length === 0
        ? null
        : await buildInboundCommunicationExternalSummary({
            grant,
            allowedCaseIds: allowedCaseIds ?? [],
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
    ...(inboundCommunicationSummary !== null
      ? { inbound_communication_summary: inboundCommunicationSummary }
      : {}),
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
