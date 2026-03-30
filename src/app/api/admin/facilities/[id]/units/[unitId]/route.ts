import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { updateFacilityUnitSchema } from '@/lib/validations/facility';

export const PATCH = withAuthContext<{ id: string; unitId: string }>(async (req, ctx, routeContext: AuthRouteContext<{ id: string; unitId: string }>) => {
  const { id, unitId } = await routeContext.params;
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateFacilityUnitSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.facilityUnit.findFirst({
    where: { id: unitId, facility_id: id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('ユニットが見つかりません');

  try {
    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.facilityUnit.update({
        where: { id: unitId },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.floor !== undefined ? { floor: parsed.data.floor } : {}),
          ...(parsed.data.unit_type !== undefined ? { unit_type: parsed.data.unit_type } : {}),
          ...(parsed.data.capacity !== undefined ? { capacity: parsed.data.capacity } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
          ...(parsed.data.display_order !== undefined ? { display_order: parsed.data.display_order } : {}),
        },
        include: {
          _count: {
            select: {
              residences: { where: { is_primary: true } },
            },
          },
        },
      });
    });

    return success({
      data: {
        id: updated.id,
        name: updated.name,
        floor: updated.floor,
        unit_type: updated.unit_type,
        capacity: updated.capacity,
        notes: updated.notes,
        display_order: updated.display_order,
        patient_count: updated._count.residences,
      },
    });
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
  message: 'ユニットの更新権限がありません',
});

export const DELETE = withAuthContext<{ id: string; unitId: string }>(async (_req, ctx, routeContext: AuthRouteContext<{ id: string; unitId: string }>) => {
  const { id, unitId } = await routeContext.params;

  const existing = await prisma.facilityUnit.findFirst({
    where: { id: unitId, facility_id: id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('ユニットが見つかりません');

  try {
    await withOrgContext(ctx.orgId, async (tx) => {
      const linkedResidence = await tx.residence.findFirst({
        where: { org_id: ctx.orgId, facility_unit_id: unitId },
        select: { id: true },
      });
      if (linkedResidence) {
        throw new Error('UNIT_IN_USE');
      }

      await tx.facilityUnit.delete({ where: { id: unitId } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNIT_IN_USE') {
      return conflict('患者が在籍中のユニットは削除できません');
    }
    throw error;
  }

  return success({ ok: true });
}, {
  permission: 'canAdmin',
  message: 'ユニットの削除権限がありません',
});
