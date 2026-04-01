import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';

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
  const siteId = searchParams.get('site_id');

  if (siteId) {
    const refResult = await validateOrgReferences(ctx.orgId, { site_id: siteId });
    if (!refResult.ok) return refResult.response;
  }

  const serviceAreas = await withOrgContext(ctx.orgId, (tx) =>
    tx.serviceArea.findMany({
      where: {
        org_id: ctx.orgId,
        ...(siteId ? { site_id: siteId } : {}),
      },
      orderBy: [{ site_id: 'asc' }, { name: 'asc' }],
      include: {
        site: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })
  );

  return success({ data: serviceAreas });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createServiceAreaSchema.safeParse(body);
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
        geo_data: parsed.data.geo_data as Prisma.InputJsonValue,
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
    })
  );

  return success({ data: serviceArea }, 201);
}
