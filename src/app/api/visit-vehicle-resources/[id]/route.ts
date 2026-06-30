import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { updateVisitVehicleResourceSchema } from '@/lib/validations/visit-vehicle-resource';
import { buildVisitVehicleResourceUpdatedAuditChanges } from '@/server/services/visit-vehicle-resource-audit';

const ROUTE = '/api/visit-vehicle-resources/[id]';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

/**
 * 次回点検期限(next_inspection_date / @db.Date)用の任意フィールド。
 * 空文字は null(クリア)に正規化する。日付のみ(UTC 深夜保存)。
 */
const nextInspectionDateSchema = z
  .preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().date().nullable(),
  )
  .optional();

async function authenticatedPATCH(req: NextRequest, params: Promise<{ id: string }>) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '車両リソースの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('車両IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateVisitVehicleResourceSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    // next_inspection_date は共有スキーマ外の専用カラムなので個別に検証する。
    const parsedInspectionDate = nextInspectionDateSchema.safeParse(payload.next_inspection_date);
    if (!parsedInspectionDate.success) {
      return validationError('入力値が不正です', {
        next_inspection_date: parsedInspectionDate.error.flatten().formErrors,
      });
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
      // 日付のみ文字列は UTC 深夜の Date として保存(@db.Date 規約)。null はクリア。
      ...(parsedInspectionDate.data !== undefined
        ? {
            next_inspection_date: parsedInspectionDate.data
              ? new Date(parsedInspectionDate.data)
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
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPATCH(req, params));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('visit_vehicle_resources_id_patch_unhandled_error', undefined, {
        event: 'visit_vehicle_resources_id_patch_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
