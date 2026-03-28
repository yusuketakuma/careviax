import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const credentials = await prisma.pharmacistCredential.findMany({
    where: {
      org_id: req.orgId,
    },
    select: {
      id: true,
      certification_type: true,
      certification_number: true,
      issued_date: true,
      expiry_date: true,
      tenure_years: true,
      weekly_work_hours: true,
      user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ expiry_date: 'asc' }, { created_at: 'desc' }],
  });

  const pharmacistIds = credentials.map((item) => item.user.id);
  const assignedPatients =
    pharmacistIds.length === 0
      ? []
      : await prisma.visitSchedule.findMany({
          where: {
            org_id: req.orgId,
            pharmacist_id: { in: pharmacistIds },
            schedule_status: { not: 'cancelled' },
            case_: {
              patient: {
                consents: {
                  some: {
                    org_id: req.orgId,
                    is_active: true,
                    revoked_date: null,
                  },
                },
              },
            },
          },
          select: {
            pharmacist_id: true,
            case_: {
              select: {
                patient: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        });

  const consentedPatientsByPharmacist = new Map<string, Array<{ id: string; name: string }>>();
  for (const schedule of assignedPatients) {
    if (!schedule.pharmacist_id) continue;
    const patient = schedule.case_?.patient;
    if (!patient) continue;

    const existing = consentedPatientsByPharmacist.get(schedule.pharmacist_id) ?? [];
    if (!existing.some((item) => item.id === patient.id)) {
      existing.push({ id: patient.id, name: patient.name });
      consentedPatientsByPharmacist.set(schedule.pharmacist_id, existing);
    }
  }

  return success({
    data: credentials.map((item) => ({
      id: item.id,
      user_id: item.user.id,
      user_name: item.user.name,
      certification_type: item.certification_type,
      certification_number: item.certification_number,
      issued_date: item.issued_date?.toISOString() ?? null,
      expiry_date: item.expiry_date?.toISOString() ?? null,
      tenure_years: item.tenure_years,
      weekly_work_hours: item.weekly_work_hours,
      consented_patients: consentedPatientsByPharmacist.get(item.user.id) ?? [],
    })),
  });
}, {
  permission: 'canAdmin',
  message: '薬剤師認定情報の閲覧権限がありません',
});
