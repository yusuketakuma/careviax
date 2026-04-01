import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, notFound, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const stockQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  drug_master_id: z.string().trim().optional(),
});

const upsertStockSchema = z.object({
  site_id: z.string().min(1, 'site_id は必須です'),
  drug_master_id: z.string().min(1, 'drug_master_id は必須です'),
  is_stocked: z.boolean().default(true),
  reorder_point: z.number().int().min(0).nullable().optional(),
  preferred_generic_id: z.string().trim().nullable().optional(),
});

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(stockQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const site = await prisma.pharmacySite.findFirst({
      where: {
        id: parsed.data.site_id,
        org_id: authCtx.orgId,
      },
      select: {
        id: true,
        name: true,
      },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');

    if (parsed.data.drug_master_id) {
      const stock = await prisma.pharmacyDrugStock.findFirst({
        where: {
          org_id: authCtx.orgId,
          site_id: site.id,
          drug_master_id: parsed.data.drug_master_id,
        },
        select: {
          id: true,
          site_id: true,
          drug_master_id: true,
          is_stocked: true,
          stock_qty: true,
          reorder_point: true,
          preferred_generic_id: true,
          updated_at: true,
          preferred_generic: {
            select: {
              id: true,
              drug_name: true,
              yj_code: true,
            },
          },
        },
      });

      return success({
        site,
        data: stock,
      });
    }

    const stocked = await prisma.pharmacyDrugStock.findMany({
      where: {
        org_id: authCtx.orgId,
        site_id: site.id,
        is_stocked: true,
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 50,
      select: {
        id: true,
        site_id: true,
        drug_master_id: true,
        is_stocked: true,
        stock_qty: true,
        reorder_point: true,
        preferred_generic_id: true,
        updated_at: true,
        drug_master: {
          select: {
            id: true,
            drug_name: true,
            yj_code: true,
          },
        },
        preferred_generic: {
          select: {
            id: true,
            drug_name: true,
            yj_code: true,
          },
        },
      },
    });

    return success({
      site,
      data: stocked,
    });
  },
  { permission: 'canAdmin' }
);

export const POST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = upsertStockSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { site_id, drug_master_id, is_stocked, reorder_point, preferred_generic_id } = parsed.data;

    const [site, targetDrug, preferredGeneric] = await Promise.all([
      prisma.pharmacySite.findFirst({
        where: {
          id: site_id,
          org_id: authCtx.orgId,
        },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.drugMaster.findFirst({
        where: { id: drug_master_id },
        select: {
          id: true,
          drug_name: true,
          generic_name: true,
          is_generic: true,
        },
      }),
      preferred_generic_id
        ? prisma.drugMaster.findFirst({
            where: { id: preferred_generic_id },
            select: {
              id: true,
              drug_name: true,
              yj_code: true,
              is_generic: true,
              generic_name: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (!site) return notFound('対象の薬局拠点が見つかりません');
    if (!targetDrug) return notFound('対象の医薬品が見つかりません');

    if (preferredGeneric && !preferredGeneric.is_generic) {
      return validationError('採用後発薬には後発品のみ指定できます', {
        preferred_generic_id: ['後発品を選択してください'],
      });
    }

    if (
      preferredGeneric &&
      targetDrug.generic_name &&
      preferredGeneric.generic_name &&
      targetDrug.generic_name !== preferredGeneric.generic_name
    ) {
      return validationError('採用後発薬は同一一般名から選択してください', {
        preferred_generic_id: ['同じ一般名の後発品を選択してください'],
      });
    }

    const stock = await prisma.pharmacyDrugStock.upsert({
      where: {
        site_id_drug_master_id: {
          site_id,
          drug_master_id,
        },
      },
      create: {
        org_id: authCtx.orgId,
        site_id,
        drug_master_id,
        is_stocked,
        reorder_point: reorder_point ?? null,
        preferred_generic_id: preferredGeneric?.id ?? null,
      },
      update: {
        is_stocked,
        reorder_point: reorder_point ?? null,
        preferred_generic_id: preferredGeneric?.id ?? null,
      },
      select: {
        id: true,
        site_id: true,
        drug_master_id: true,
        is_stocked: true,
        stock_qty: true,
        reorder_point: true,
        preferred_generic_id: true,
        updated_at: true,
        preferred_generic: {
          select: {
            id: true,
            drug_name: true,
            yj_code: true,
          },
        },
      },
    });

    return success({
      site,
      data: stock,
    });
  },
  { permission: 'canAdmin' }
);
