import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { createFacilitySchema } from '@/lib/validations/facility';
import { serializeFacilityResponse, toFacilityTimeValue } from '@/lib/facilities/facility-api';

export const GET = withAuthContext(
  async (_req, ctx) => {
    const [facilities, residenceCounts] = await Promise.all([
      prisma.facility.findMany({
        where: { org_id: ctx.orgId },
        include: {
          contacts: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
          },
        },
        orderBy: [{ name: 'asc' }],
      }),
      prisma.residence.groupBy({
        by: ['facility_id'],
        where: {
          org_id: ctx.orgId,
          is_primary: true,
          facility_id: {
            not: null,
          },
        },
        _count: {
          _all: true,
        },
      }),
    ]);
    const patientCountByFacilityId = new Map(
      residenceCounts
        .filter((item) => item.facility_id)
        .map((item) => [item.facility_id as string, item._count._all]),
    );

    return success({
      data: facilities.map((facility) =>
        serializeFacilityResponse(
          {
            ...facility,
            patient_count: patientCountByFacilityId.get(facility.id) ?? 0,
          },
          { includeTimestamps: true },
        ),
      ),
    });
  },
  {
    permission: 'canVisit',
    message: '施設情報の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createFacilitySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(ctx.orgId, async (tx) =>
      tx.facility.create({
        data: {
          org_id: ctx.orgId,
          name: parsed.data.name,
          facility_type: parsed.data.facility_type,
          address: parsed.data.address || null,
          phone: parsed.data.phone || null,
          fax: parsed.data.fax || null,
          acceptance_time_from: toFacilityTimeValue(parsed.data.acceptance_time_from),
          acceptance_time_to: toFacilityTimeValue(parsed.data.acceptance_time_to),
          regular_visit_weekdays: toPrismaJsonInput(parsed.data.regular_visit_weekdays),
          notes: parsed.data.notes || null,
          contacts: parsed.data.contacts.length
            ? {
                create: parsed.data.contacts.map((contact) => ({
                  org_id: ctx.orgId,
                  name: contact.name,
                  role: contact.role || null,
                  phone: contact.phone || null,
                  email: contact.email || null,
                  fax: contact.fax || null,
                  is_primary: contact.is_primary,
                  notes: contact.notes || null,
                })),
              }
            : undefined,
        },
        include: {
          contacts: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
          },
        },
      }),
    );

    return success({ data: serializeFacilityResponse(created, { includeTimestamps: true }) }, 201);
  },
  {
    permission: 'canAdmin',
    message: '施設マスターの更新権限がありません',
  },
);
