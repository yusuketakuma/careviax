import { NextRequest } from 'next/server';
import { z } from 'zod';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { requireAuthContext } from '@/lib/auth/context';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const DEFAULT_SERVICE_AREA_LIMIT = 100;
const MAX_SERVICE_AREA_LIMIT = 200;

const siteIdQuerySchema = z.string().trim().min(1).max(100);

const createServiceAreaSchema = z.object({
  site_id: z.string().min(1, 'site_id は必須です'),
  name: z.string().trim().min(1, 'name は必須です'),
  area_type: z.enum(['radius', 'polygon']),
  geo_data: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().trim().optional(),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canVisit' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const siteIdRaw = searchParams.get('site_id');
  const parsedSiteId = siteIdRaw === null ? null : siteIdQuerySchema.safeParse(siteIdRaw);
  const limit = parseBoundedInteger(
    searchParams.get('limit'),
    DEFAULT_SERVICE_AREA_LIMIT,
    1,
    MAX_SERVICE_AREA_LIMIT,
  );

  if (parsedSiteId && !parsedSiteId.success) {
    return validationError('検索条件が不正です', {
      site_id: ['site_id が不正です'],
    });
  }

  if (parsedSiteId?.success) {
    const refResult = await validateOrgReferences(ctx.orgId, { site_id: parsedSiteId.data });
    if (!refResult.ok) return refResult.response;
  }

  const serviceAreas = await withOrgContext(ctx.orgId, (tx) =>
    tx.serviceArea.findMany({
      where: {
        org_id: ctx.orgId,
        ...(parsedSiteId?.success ? { site_id: parsedSiteId.data } : {}),
      },
      orderBy: [{ site_id: 'asc' }, { name: 'asc' }],
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
  );

  return success({ data: serviceAreas });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createServiceAreaSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const refResult = await validateOrgReferences(ctx.orgId, {
    site_id: parsed.data.site_id,
  });
  if (!refResult.ok) return refResult.response;

  const serviceArea = await withOrgContext(ctx.orgId, (tx) =>
    tx.serviceArea.create({
      data: {
        org_id: ctx.orgId,
        site_id: parsed.data.site_id,
        name: parsed.data.name,
        area_type: parsed.data.area_type,
        geo_data: toPrismaJsonInput(parsed.data.geo_data),
        notes: parsed.data.notes || null,
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

  return success({ data: serviceArea }, 201);
}
