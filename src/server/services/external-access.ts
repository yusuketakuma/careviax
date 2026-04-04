import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { startOfDay } from 'date-fns';
import { decode, encode } from 'next-auth/jwt';
import { prisma } from '@/lib/db/client';

type ExternalGrantRecord = {
  id: string;
  org_id: string;
  patient_id: string;
  otp_hash: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  scope: unknown;
};

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

/** @deprecated Use bcrypt.hash directly for new OTP hashes; kept for migration compatibility. */
export async function hashExternalAccessOtp(otp: string) {
  return bcrypt.hash(otp, 12);
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
  const secret = process.env.EXTERNAL_ACCESS_TOKEN_SECRET;
  if (!secret) {
    throw new MissingExternalAccessSecretError();
  }
  return secret;
}

function isExternalAccessTokenPayload(
  payload: Record<string, unknown>
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
  otp: string | null | undefined
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

  if (grant.otp_hash) {
    if (!otp) {
      return {
        ok: false,
        kind: 'validation',
        message: 'OTPが必要です',
      };
    }

    const isValid = await bcrypt.compare(otp, grant.otp_hash);
    if (!isValid) {
      return {
        ok: false,
        kind: 'validation',
        message: 'OTPが正しくありません',
      };
    }
  }

  return { ok: true, grant };
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
    headline:
      headlineParts.join(' / ') || `${args.patientName}さんの共有情報を確認できます。`,
    bullets,
    key_medications: medicationNames,
    next_visit_date: nextVisitDate?.toISOString() ?? null,
  };
}

export async function buildExternalAccessPayload(grant: ExternalGrantRecord) {
  const scope = ((grant.scope ?? {}) as Record<string, boolean>) ?? {};

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
      ? (patient as Record<string, unknown>).allergy_info ?? null
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
    selfReportHistory =
      (await prisma.patientSelfReport?.findMany?.({
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
      })) ?? [];
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
