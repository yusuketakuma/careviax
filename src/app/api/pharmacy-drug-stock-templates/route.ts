import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';

const templateQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: boundedIntegerSearchParam('limit', 1, 100, 50),
});

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'テンプレート名は必須です').max(100),
  description: z.string().trim().max(500).nullable().optional(),
  source_site_id: z.string().trim().min(1, 'source_site_id は必須です'),
});

const authenticatedGET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const parsed = parseSearchParams(templateQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const templates = await prisma.formularyTemplate.findMany({
      where: {
        org_id: authCtx.orgId,
        ...(parsed.data.q
          ? {
              OR: [
                { name: { contains: parsed.data.q } },
                { description: { contains: parsed.data.q } },
              ],
            }
          : {}),
      },
      orderBy: [{ created_at: 'desc' }],
      take: parsed.data.limit,
      select: {
        id: true,
        name: true,
        description: true,
        source_site_id: true,
        item_count: true,
        created_at: true,
      },
    });

    return success({ data: templates });
  },
  { permission: 'canAdmin' },
);

export const GET: typeof authenticatedGET = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedGET(req, routeContext));

const authenticatedPOST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createTemplateSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const [site, existingTemplate] = await Promise.all([
      prisma.pharmacySite.findFirst({
        where: { id: parsed.data.source_site_id, org_id: authCtx.orgId },
        select: { id: true, name: true },
      }),
      prisma.formularyTemplate.findFirst({
        where: { org_id: authCtx.orgId, name: parsed.data.name },
        select: { id: true, name: true },
      }),
    ]);
    if (!site) return notFound('対象の薬局拠点が見つかりません');
    if (existingTemplate) {
      return conflict('同じ名前の採用品テンプレートがすでに存在します', {
        template_id: existingTemplate.id,
        name: existingTemplate.name,
      });
    }

    const sourceStocks = await prisma.pharmacyDrugStock.findMany({
      where: {
        org_id: authCtx.orgId,
        site_id: site.id,
        is_stocked: true,
      },
      orderBy: [{ updated_at: 'desc' }],
      select: {
        drug_master_id: true,
        reorder_point: true,
        preferred_generic_id: true,
        adoption_note: true,
      },
    });
    if (sourceStocks.length === 0) {
      return conflict('テンプレート化する採用品がありません', { source_site_id: site.id });
    }

    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.formularyTemplate.create({
        data: {
          org_id: authCtx.orgId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          source_site_id: site.id,
          created_by_id: authCtx.userId,
          item_count: sourceStocks.length,
          items: sourceStocks.map((stock) => ({
            drug_master_id: stock.drug_master_id,
            reorder_point: stock.reorder_point,
            preferred_generic_id: stock.preferred_generic_id,
            adoption_note: stock.adoption_note,
          })),
        },
      });

      await createAuditLogEntry(tx, authCtx, {
        action: 'formulary_template_created',
        targetType: 'FormularyTemplate',
        targetId: created.id,
        changes: {
          source_site_id: site.id,
          item_count: sourceStocks.length,
        },
      });

      return created;
    });

    return success({ site, data: template }, 201);
  },
  { permission: 'canAdmin' },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedPOST(req, routeContext));
