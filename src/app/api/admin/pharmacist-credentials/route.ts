import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createPharmacistCredentialSchema } from '@/lib/validations/pharmacist-credential';

export const GET = withAuthContext(
  async (_req, ctx) => {
    const credentials = await prisma.pharmacistCredential.findMany({
      where: {
        org_id: ctx.orgId,
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
              org_id: ctx.orgId,
              pharmacist_id: { in: pharmacistIds },
              schedule_status: { notIn: ['cancelled', 'rescheduled'] },
              case_: {
                patient: {
                  consents: {
                    some: {
                      org_id: ctx.orgId,
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
  },
  {
    permission: 'canAdmin',
    message: '薬剤師認定情報の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPharmacistCredentialSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const refResult = await validateOrgReferences(ctx.orgId, {
      pharmacist_id: parsed.data.user_id,
    });
    if (!refResult.ok) return refResult.response;

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      const credential = await tx.pharmacistCredential.create({
        data: {
          org_id: ctx.orgId,
          user_id: parsed.data.user_id,
          certification_type: parsed.data.certification_type,
          certification_number: parsed.data.certification_number ?? null,
          issued_date: parsed.data.issued_date ? new Date(parsed.data.issued_date) : null,
          expiry_date: parsed.data.expiry_date ? new Date(parsed.data.expiry_date) : null,
          tenure_years: parsed.data.tenure_years ?? null,
          weekly_work_hours: parsed.data.weekly_work_hours ?? null,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacist_credential_created',
        targetType: 'PharmacistCredential',
        targetId: credential.id,
        changes: {
          user_id: parsed.data.user_id,
          certification_type: parsed.data.certification_type,
          expiry_date: parsed.data.expiry_date ?? null,
        },
      });

      return credential;
    });

    return success(
      {
        data: {
          id: created.id,
          user_id: created.user.id,
          user_name: created.user.name,
          certification_type: created.certification_type,
          certification_number: created.certification_number,
          issued_date: created.issued_date?.toISOString() ?? null,
          expiry_date: created.expiry_date?.toISOString() ?? null,
          tenure_years: created.tenure_years,
          weekly_work_hours: created.weekly_work_hours,
          consented_patients: [],
        },
      },
      201,
    );
  },
  {
    permission: 'canAdmin',
    message: '薬剤師認定情報の作成権限がありません',
  },
);
