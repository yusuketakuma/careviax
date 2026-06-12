import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { updateVisitVehicleResourceSchema } from '@/lib/validations/visit-vehicle-resource';

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, routeContext) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('車両IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateVisitVehicleResourceSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    // 指定されたフィールドのみ更新対象にする(undefined は据え置き、null はクリア)。
    const data = {
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.vehicle_code !== undefined ? { vehicle_code: parsed.data.vehicle_code } : {}),
      ...(parsed.data.travel_mode !== undefined ? { travel_mode: parsed.data.travel_mode } : {}),
      ...(parsed.data.max_stops !== undefined ? { max_stops: parsed.data.max_stops } : {}),
      ...(parsed.data.max_route_duration_minutes !== undefined
        ? { max_route_duration_minutes: parsed.data.max_route_duration_minutes }
        : {}),
      ...(parsed.data.available !== undefined ? { available: parsed.data.available } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    };

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.visitVehicleResource.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true },
      });
      if (!existing) return null;

      const resource = await tx.visitVehicleResource.update({
        where: { id },
        data,
        include: {
          site: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'visit_vehicle_resource_updated',
        targetType: 'VisitVehicleResource',
        targetId: id,
        changes: data,
      });

      return resource;
    });

    if (!updated) return notFound('車両リソースが見つかりません');

    return success({ data: updated });
  },
  {
    permission: 'canAdmin',
    message: '車両リソースの更新権限がありません',
  },
);
