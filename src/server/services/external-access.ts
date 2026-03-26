import { createHash } from 'crypto';
import { startOfDay } from 'date-fns';
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

export function hashExternalAccessOtp(otp: string) {
  return createHash('sha256').update(otp).digest('hex');
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

  if (!grant || grant.revoked_at || grant.expires_at < new Date()) {
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

    if (hashExternalAccessOtp(otp) !== grant.otp_hash) {
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

export async function buildExternalAccessPayload(grant: ExternalGrantRecord) {
  const scope = ((grant.scope ?? {}) as Record<string, boolean>) ?? {};

  const patient = await prisma.patient.findFirst({
    where: { id: grant.patient_id, org_id: grant.org_id },
    select: {
      id: true,
      name: true,
      birth_date: true,
      gender: true,
      phone: true,
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

  return {
    patient,
    ...(allergyInfo !== null ? { allergy_info: allergyInfo } : {}),
    ...(medicationProfiles !== null ? { medication_profiles: medicationProfiles } : {}),
    ...(visitSchedules !== null ? { visit_schedules: visitSchedules } : {}),
    ...(careReports !== null ? { care_reports: careReports } : {}),
    scope,
    expires_at: grant.expires_at,
  };
}
