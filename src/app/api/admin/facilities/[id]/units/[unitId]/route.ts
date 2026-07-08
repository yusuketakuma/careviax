import { unstable_rethrow } from 'next/navigation';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { updateFacilityUnitSchema } from '@/lib/validations/facility';

const authenticatedPATCH = withAuthContext<{ id: string; unitId: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ id: string; unitId: string }>) => {
    const { id: rawId, unitId: rawUnitId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('施設IDが不正です');
    const unitId = normalizeRequiredRouteParam(rawUnitId);
    if (!unitId) return validationError('ユニットIDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateFacilityUnitSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    try {
      const updatedResult = await withOrgContext(ctx.orgId, async (tx) => {
        const existing = await tx.facilityUnit.findFirst({
          where: { id: unitId, facility_id: id, org_id: ctx.orgId },
          select: {
            id: true,
            facility_id: true,
            name: true,
            floor: true,
            unit_type: true,
            capacity: true,
            notes: true,
            display_order: true,
          },
        });
        if (!existing) return { kind: 'not_found' as const };

        const updated = await tx.facilityUnit.update({
          where: { id: unitId },
          data: {
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(parsed.data.floor !== undefined ? { floor: parsed.data.floor } : {}),
            ...(parsed.data.unit_type !== undefined ? { unit_type: parsed.data.unit_type } : {}),
            ...(parsed.data.capacity !== undefined ? { capacity: parsed.data.capacity } : {}),
            ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
            ...(parsed.data.display_order !== undefined
              ? { display_order: parsed.data.display_order }
              : {}),
          },
          include: {
            _count: {
              select: {
                residences: { where: { is_primary: true } },
              },
            },
          },
        });

        await createAuditLogEntry(tx, ctx, {
          action: 'facility_unit_updated',
          targetType: 'FacilityUnit',
          targetId: updated.id,
          changes: {
            facility_id: existing.facility_id,
            previous: {
              name: existing.name,
              floor: existing.floor,
              unit_type: existing.unit_type,
              capacity: existing.capacity,
              notes: existing.notes,
              display_order: existing.display_order,
            },
            next: {
              name: updated.name,
              floor: updated.floor,
              unit_type: updated.unit_type,
              capacity: updated.capacity,
              notes: updated.notes,
              display_order: updated.display_order,
            },
          },
        });

        return { kind: 'updated' as const, unit: updated };
      });
      if (updatedResult.kind === 'not_found') return notFound('ユニットが見つかりません');
      const updated = updatedResult.unit;

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
  },
  {
    permission: 'canAdmin',
    message: 'ユニットの更新権限がありません',
  },
);

const authenticatedDELETE = withAuthContext<{ id: string; unitId: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string; unitId: string }>) => {
    const { id: rawId, unitId: rawUnitId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('施設IDが不正です');
    const unitId = normalizeRequiredRouteParam(rawUnitId);
    if (!unitId) return validationError('ユニットIDが不正です');

    const deleted = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.facilityUnit.findFirst({
        where: { id: unitId, facility_id: id, org_id: ctx.orgId },
        select: {
          id: true,
          facility_id: true,
          name: true,
          floor: true,
          unit_type: true,
          capacity: true,
          notes: true,
          display_order: true,
        },
      });
      if (!existing) return { kind: 'not_found' as const };

      const linkedResidence = await tx.residence.findFirst({
        where: { org_id: ctx.orgId, facility_unit_id: unitId },
        select: { id: true },
      });
      if (linkedResidence) return { kind: 'in_use' as const };

      await tx.facilityUnit.delete({ where: { id: unitId } });

      await createAuditLogEntry(tx, ctx, {
        action: 'facility_unit_deleted',
        targetType: 'FacilityUnit',
        targetId: existing.id,
        changes: {
          facility_id: existing.facility_id,
          name: existing.name,
          floor: existing.floor,
          unit_type: existing.unit_type,
          capacity: existing.capacity,
          notes: existing.notes,
          display_order: existing.display_order,
        },
      });

      return { kind: 'deleted' as const };
    });
    if (deleted.kind === 'not_found') return notFound('ユニットが見つかりません');
    if (deleted.kind === 'in_use') return conflict('患者が在籍中のユニットは削除できません');

    return success({ data: { id: unitId } });
  },
  {
    permission: 'canAdmin',
    message: 'ユニットの削除権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const DELETE: typeof authenticatedDELETE = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedDELETE(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
