import { withAuthContext } from '@/lib/auth/context';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import {
  createVisitVehicleResourceSchema,
  visitVehicleResourceQuerySchema,
} from '@/lib/validations/visit-vehicle-resource';

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = visitVehicleResourceQuerySchema.safeParse({
      ...(searchParams.has('site_id') ? { site_id: searchParams.get('site_id') } : {}),
      ...(searchParams.has('available') ? { available: searchParams.get('available') } : {}),
    });
    if (!parsed.success) {
      return validationError('検索条件が不正です', parsed.error.flatten().fieldErrors);
    }

    if (parsed.data.site_id) {
      const refResult = await validateOrgReferences(ctx.orgId, { site_id: parsed.data.site_id });
      if (!refResult.ok) return refResult.response;
    }

    const resources = await withOrgContext(ctx.orgId, (tx) =>
      tx.visitVehicleResource.findMany({
        where: {
          org_id: ctx.orgId,
          ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
          ...(parsed.data.available !== undefined ? { available: parsed.data.available } : {}),
        },
        orderBy: [{ site_id: 'asc' }, { label: 'asc' }],
        include: {
          site: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    );

    return success({ data: resources });
  },
  {
    permission: 'canVisit',
    message: '車両リソースの閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createVisitVehicleResourceSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const refResult = await validateOrgReferences(ctx.orgId, { site_id: parsed.data.site_id });
    if (!refResult.ok) return refResult.response;

    const resource = await withOrgContext(ctx.orgId, (tx) =>
      tx.visitVehicleResource.create({
        data: {
          org_id: ctx.orgId,
          site_id: parsed.data.site_id,
          label: parsed.data.label,
          vehicle_code: parsed.data.vehicle_code ?? null,
          travel_mode: parsed.data.travel_mode,
          max_stops: parsed.data.max_stops,
          max_route_duration_minutes: parsed.data.max_route_duration_minutes ?? null,
          available: parsed.data.available,
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
      }),
    );

    return success({ data: resource }, 201);
  },
  {
    permission: 'canAdmin',
    message: '車両リソースの作成権限がありません',
  },
);
