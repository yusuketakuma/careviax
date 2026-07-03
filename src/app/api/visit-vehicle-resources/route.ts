import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCountedListEnvelope } from '@/lib/api/list-envelope';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  createVisitVehicleResourceSchema,
  visitVehicleResourceQuerySchema,
} from '@/lib/validations/visit-vehicle-resource';
import { buildVisitVehicleResourceCreatedAuditChanges } from '@/server/services/visit-vehicle-resource-audit';

const ROUTE = '/api/visit-vehicle-resources';
const DEFAULT_VISIT_VEHICLE_RESOURCE_LIMIT = 100;
const MAX_VISIT_VEHICLE_RESOURCE_LIMIT = 200;

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '車両リソースの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const parsed = visitVehicleResourceQuerySchema.safeParse({
      ...(searchParams.has('site_id') ? { site_id: searchParams.get('site_id') } : {}),
      ...(searchParams.has('available') ? { available: searchParams.get('available') } : {}),
    });
    if (!parsed.success) {
      return validationError('検索条件が不正です', parsed.error.flatten().fieldErrors);
    }
    const limit = parseBoundedInteger(
      searchParams.get('limit'),
      DEFAULT_VISIT_VEHICLE_RESOURCE_LIMIT,
      1,
      MAX_VISIT_VEHICLE_RESOURCE_LIMIT,
    );

    if (parsed.data.site_id) {
      const refResult = await validateOrgReferences(ctx.orgId, { site_id: parsed.data.site_id });
      if (!refResult.ok) return refResult.response;
    }

    const where = {
      org_id: ctx.orgId,
      ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
      ...(parsed.data.available !== undefined ? { available: parsed.data.available } : {}),
    };

    const [totalCount, resources] = await withOrgContext(
      ctx.orgId,
      (tx) =>
        Promise.all([
          tx.visitVehicleResource.count({ where }),
          tx.visitVehicleResource.findMany({
            where,
            orderBy: [{ site_id: 'asc' }, { label: 'asc' }],
            take: limit,
            include: {
              site: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          }),
        ]),
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );
    return success({
      ...buildCountedListEnvelope(resources, totalCount),
      count_basis: 'visit_vehicle_resources',
      filters_applied: {
        ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
        ...(parsed.data.available !== undefined ? { available: parsed.data.available } : {}),
      },
      limit,
    });
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'visit_vehicle_resources_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '車両リソースの作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createVisitVehicleResourceSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const refResult = await validateOrgReferences(ctx.orgId, { site_id: parsed.data.site_id });
    if (!refResult.ok) return refResult.response;

    const resource = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const created = await tx.visitVehicleResource.create({
          data: {
            org_id: ctx.orgId,
            site_id: parsed.data.site_id,
            label: parsed.data.label,
            vehicle_code: parsed.data.vehicle_code ?? null,
            travel_mode: parsed.data.travel_mode,
            max_stops: parsed.data.max_stops,
            max_route_duration_minutes: parsed.data.max_route_duration_minutes ?? null,
            available: parsed.data.available,
            next_inspection_date: parsed.data.next_inspection_date
              ? new Date(parsed.data.next_inspection_date)
              : null,
            notes: parsed.data.notes ?? null,
          },
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
          action: 'visit_vehicle_resource_created',
          targetType: 'VisitVehicleResource',
          targetId: created.id,
          changes: buildVisitVehicleResourceCreatedAuditChanges(created),
        });

        return created;
      },
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    return success({ data: resource }, 201);
  });
}

export async function POST(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'visit_vehicle_resources_post_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
