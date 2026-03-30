import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { createFacilityUnitSchema } from '@/lib/validations/facility';

export const GET = withAuthContext<{ id: string }>(async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;

  const facility = await prisma.facility.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!facility) return notFound('施設が見つかりません');

  const units = await prisma.facilityUnit.findMany({
    where: { org_id: ctx.orgId, facility_id: id },
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    include: {
      _count: {
        select: {
          residences: { where: { is_primary: true } },
        },
      },
    },
  });

  return success({
    data: units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      floor: unit.floor,
      unit_type: unit.unit_type,
      capacity: unit.capacity,
      notes: unit.notes,
      display_order: unit.display_order,
      patient_count: unit._count.residences,
    })),
  });
}, {
  permission: 'canVisit',
  message: 'ユニットの閲覧権限がありません',
});

export const POST = withAuthContext<{ id: string }>(async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createFacilityUnitSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const facility = await prisma.facility.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!facility) return notFound('施設が見つかりません');

  try {
    const unit = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.facilityUnit.create({
        data: {
          org_id: ctx.orgId,
          facility_id: id,
          name: parsed.data.name,
          floor: parsed.data.floor || null,
          unit_type: parsed.data.unit_type,
          capacity: parsed.data.capacity ?? null,
          notes: parsed.data.notes || null,
          display_order: parsed.data.display_order,
        },
      });
    });

    return success({ data: { ...unit, patient_count: 0 } }, 201);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Unique constraint') &&
      error.message.includes('FacilityUnit_org_id_facility_id_name_key')
    ) {
      return conflict('同じ名前のユニットが既に存在します');
    }
    throw error;
  }
}, {
  permission: 'canAdmin',
  message: 'ユニットの作成権限がありません',
});
