import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { startOfDay } from 'date-fns';
import { success, notFound, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

/**
 * Public endpoint — no authentication required.
 * Validates token + OTP, returns scoped patient data.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token || typeof token !== 'string' || token.length < 8) {
    return notFound('共有リンクが無効です');
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');

  const grant = await prisma.externalAccessGrant.findUnique({
    where: { token_hash: tokenHash },
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

  if (!grant) return notFound('共有リンクが無効または期限切れです');
  if (grant.revoked_at) return notFound('共有リンクは取り消されています');
  if (grant.expires_at < new Date()) return notFound('共有リンクの有効期限が切れています');

  // OTP validation
  const otpParam = req.nextUrl.searchParams.get('otp');
  if (!otpParam) {
    return validationError('OTPが必要です');
  }

  const otpHash = createHash('sha256').update(otpParam).digest('hex');
  if (otpHash !== grant.otp_hash) {
    return validationError('OTPが正しくありません');
  }

  // Record access time
  await prisma.externalAccessGrant.update({
    where: { token_hash: tokenHash },
    data: { accessed_at: new Date() },
  });

  const scope = (grant.scope ?? {}) as Record<string, boolean>;

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

  if (!patient) return notFound('患者情報が見つかりません');

  const allergyInfo = scope.allergy_info === true
    ? (patient as Record<string, unknown>).allergy_info ?? null
    : null;

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

    const caseIds = activeCases.map((c) => c.id);
    if (caseIds.length > 0) {
      visitSchedules = await prisma.visitSchedule.findMany({
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
    } else {
      visitSchedules = [];
    }
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

  return success({
    data: {
      patient,
      ...(allergyInfo !== null ? { allergy_info: allergyInfo } : {}),
      ...(medicationProfiles !== null ? { medication_profiles: medicationProfiles } : {}),
      ...(visitSchedules !== null ? { visit_schedules: visitSchedules } : {}),
      ...(careReports !== null ? { care_reports: careReports } : {}),
      scope,
      expires_at: grant.expires_at,
    },
  });
}
