import type { Prisma } from '@prisma/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { createFacilitySchema } from '@/lib/validations/facility';

function toTimeValue(value?: string | null) {
  if (!value) return null;
  const [hours = '0', minutes = '0'] = value.split(':');
  return new Date(Date.UTC(1970, 0, 1, Number.parseInt(hours, 10), Number.parseInt(minutes, 10)));
}

function formatTimeValue(value: Date | null) {
  if (!value) return null;
  const hours = `${value.getUTCHours()}`.padStart(2, '0');
  const minutes = `${value.getUTCMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function toResponse(
  facility: Prisma.FacilityGetPayload<{
    include: { contacts: true };
  }> & {
    patient_count?: number;
  },
) {
  return {
    id: facility.id,
    name: facility.name,
    facility_type: facility.facility_type,
    address: facility.address,
    phone: facility.phone,
    fax: facility.fax,
    acceptance_time_from: formatTimeValue(facility.acceptance_time_from),
    acceptance_time_to: formatTimeValue(facility.acceptance_time_to),
    regular_visit_weekdays: Array.isArray(facility.regular_visit_weekdays)
      ? facility.regular_visit_weekdays
      : [],
    patient_count: facility.patient_count ?? 0,
    notes: facility.notes,
    contacts: facility.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role,
      phone: contact.phone,
      email: contact.email,
      fax: contact.fax,
      is_primary: contact.is_primary,
      notes: contact.notes,
    })),
    created_at: facility.created_at.toISOString(),
    updated_at: facility.updated_at.toISOString(),
  };
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const [facilities, residenceCounts] = await Promise.all([
      prisma.facility.findMany({
        where: { org_id: req.orgId },
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
          org_id: req.orgId,
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
        toResponse({
          ...facility,
          patient_count: patientCountByFacilityId.get(facility.id) ?? 0,
        }),
      ),
    });
  },
  {
    permission: 'canVisit',
    message: '施設情報の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createFacilitySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(req.orgId, async (tx) =>
      tx.facility.create({
        data: {
          org_id: req.orgId,
          name: parsed.data.name,
          facility_type: parsed.data.facility_type,
          address: parsed.data.address || null,
          phone: parsed.data.phone || null,
          fax: parsed.data.fax || null,
          acceptance_time_from: toTimeValue(parsed.data.acceptance_time_from),
          acceptance_time_to: toTimeValue(parsed.data.acceptance_time_to),
          regular_visit_weekdays: toPrismaJsonInput(parsed.data.regular_visit_weekdays),
          notes: parsed.data.notes || null,
          contacts: parsed.data.contacts.length
            ? {
                create: parsed.data.contacts.map((contact) => ({
                  org_id: req.orgId,
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

    return success({ data: toResponse(created) }, 201);
  },
  {
    permission: 'canAdmin',
    message: '施設マスターの更新権限がありません',
  },
);
