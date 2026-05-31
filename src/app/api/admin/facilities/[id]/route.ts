import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { updateFacilitySchema } from '@/lib/validations/facility';

function toTimeValue(value?: string | null) {
  if (!value) return null;
  const [hours = '0', minutes = '0'] = value.split(':');
  return new Date(
    Date.UTC(1970, 0, 1, Number.parseInt(hours, 10), Number.parseInt(minutes, 10))
  );
}

function formatTimeValue(value: Date | null) {
  if (!value) return null;
  const hours = `${value.getUTCHours()}`.padStart(2, '0');
  const minutes = `${value.getUTCMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function toResponse(facility: {
  id: string;
  name: string;
  facility_type: string;
  address: string | null;
  phone: string | null;
  fax: string | null;
  acceptance_time_from: Date | null;
  acceptance_time_to: Date | null;
  regular_visit_weekdays: unknown;
  notes: string | null;
  patient_count?: number;
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
    fax: string | null;
    is_primary: boolean;
    notes: string | null;
  }>;
  _count?: {
    residences: number;
  };
}) {
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
    notes: facility.notes,
    patient_count: facility.patient_count ?? facility._count?.residences ?? 0,
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
  };
}

export const GET = withAuthContext<{ id: string }>(async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;

  const facility = await prisma.facility.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      contacts: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      },
      _count: {
        select: {
          residences: true,
        },
      },
    },
  });
  if (!facility) return notFound('施設が見つかりません');

  const patient_count = await prisma.residence.count({
    where: {
      org_id: ctx.orgId,
      facility_id: id,
      is_primary: true,
    },
  });

  return success({ data: toResponse({ ...facility, patient_count }) });
}, {
  permission: 'canVisit',
  message: '施設マスターの閲覧権限がありません',
});

export const PATCH = withAuthContext<{ id: string }>(async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateFacilitySchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.facility.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('施設が見つかりません');

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    if (parsed.data.contacts) {
      await tx.facilityContact.deleteMany({
        where: { org_id: ctx.orgId, facility_id: id },
      });
    }

    return tx.facility.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.facility_type !== undefined ? { facility_type: parsed.data.facility_type } : {}),
        ...(parsed.data.address !== undefined ? { address: parsed.data.address || null } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
        ...(parsed.data.fax !== undefined ? { fax: parsed.data.fax || null } : {}),
        ...(parsed.data.acceptance_time_from !== undefined
          ? { acceptance_time_from: toTimeValue(parsed.data.acceptance_time_from) }
          : {}),
        ...(parsed.data.acceptance_time_to !== undefined
          ? { acceptance_time_to: toTimeValue(parsed.data.acceptance_time_to) }
          : {}),
        ...(parsed.data.regular_visit_weekdays !== undefined
          ? {
              regular_visit_weekdays: toPrismaJsonInput(parsed.data.regular_visit_weekdays),
            }
          : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
        ...(parsed.data.contacts
          ? {
              contacts: {
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
              },
            }
          : {}),
      },
      include: {
        contacts: {
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        },
      },
    });
  });

  return success({ data: toResponse(updated) });
}, {
  permission: 'canAdmin',
  message: '施設マスターの更新権限がありません',
});

export const DELETE = withAuthContext<{ id: string }>(async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;

  const existing = await prisma.facility.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('施設が見つかりません');

  try {
    await withOrgContext(ctx.orgId, async (tx) => {
      const linkedResidence = await tx.residence.findFirst({
        where: {
          org_id: ctx.orgId,
          facility_id: id,
        },
        select: {
          id: true,
        },
      });
      if (linkedResidence) {
        throw new Error('FACILITY_IN_USE');
      }

      await tx.facility.delete({ where: { id } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'FACILITY_IN_USE') {
      return conflict('利用中の患者がいる施設は削除できません');
    }
    throw error;
  }

  return success({ ok: true });
}, {
  permission: 'canAdmin',
  message: '施設マスターの更新権限がありません',
});
