import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { parseJsonObjectRequestBodyOrError } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { updateVisitVehicleResourceSchema } from '@/lib/validations/visit-vehicle-resource';
import { buildVisitVehicleResourceUpdatedAuditChanges } from '@/server/services/visit-vehicle-resource-audit';

async function authenticatedPATCH(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('車両IDが不正です');

  const parsed = await parseJsonObjectRequestBodyOrError(req, updateVisitVehicleResourceSchema);
  if (!parsed.ok) return parsed.response;

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
    // 日付のみ文字列は UTC 深夜の Date として保存(@db.Date 規約)。null はクリア。
    ...(parsed.data.next_inspection_date !== undefined
      ? {
          next_inspection_date: parsed.data.next_inspection_date
            ? new Date(parsed.data.next_inspection_date)
            : null,
        }
      : {}),
  };

  const updated = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const existing = await tx.visitVehicleResource.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          site_id: true,
          label: true,
          vehicle_code: true,
          travel_mode: true,
          max_stops: true,
          max_route_duration_minutes: true,
          available: true,
          next_inspection_date: true,
          notes: true,
        },
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

      const auditChanges = buildVisitVehicleResourceUpdatedAuditChanges(existing, resource);
      if (Object.keys(auditChanges).length > 0) {
        await createAuditLogEntry(tx, ctx, {
          action: 'visit_vehicle_resource_updated',
          targetType: 'VisitVehicleResource',
          targetId: id,
          changes: auditChanges,
        });
      }

      return resource;
    },
    { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
  );

  if (!updated) return notFound('車両リソースが見つかりません');

  return success({ data: updated });
}

export const PATCH = withAuthContext(authenticatedPATCH, {
  permission: 'canAdmin',
  message: '車両リソースの更新権限がありません',
});
