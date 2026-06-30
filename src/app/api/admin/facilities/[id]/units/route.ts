import { unstable_rethrow } from 'next/navigation';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { createFacilityUnitSchema } from '@/lib/validations/facility';

const authenticatedGET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('施設IDが不正です');

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
  },
  {
    permission: 'canVisit',
    message: 'ユニットの閲覧権限がありません',
  },
);

const authenticatedPOST = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('施設IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createFacilityUnitSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    try {
      const created = await withOrgContext(ctx.orgId, async (tx) => {
        const facility = await tx.facility.findFirst({
          where: { id, org_id: ctx.orgId },
          select: { id: true },
        });
        if (!facility) return { kind: 'not_found' as const };

        const unit = await tx.facilityUnit.create({
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

        await createAuditLogEntry(tx, ctx, {
          action: 'facility_unit_created',
          targetType: 'FacilityUnit',
          targetId: unit.id,
          changes: {
            facility_id: id,
            name: unit.name,
            floor: unit.floor,
            unit_type: unit.unit_type,
            capacity: unit.capacity,
            display_order: unit.display_order,
          },
        });

        return { kind: 'created' as const, unit };
      });
      if (created.kind === 'not_found') return notFound('施設が見つかりません');
      const { unit } = created;

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
  },
  {
    permission: 'canAdmin',
    message: 'ユニットの作成権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
