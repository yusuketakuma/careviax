import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const historyQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  drug_master_id: z.string().trim().min(1, 'drug_master_id は必須です'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function includesDrugMasterId(changes: unknown, drugMasterId: string) {
  const data = readObject(changes);
  if (data.drug_master_id === drugMasterId) return true;
  const drugMasterIds = data.drug_master_ids;
  return Array.isArray(drugMasterIds) && drugMasterIds.includes(drugMasterId);
}

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const parsed = parseSearchParams(historyQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: parsed.data.site_id, org_id: authCtx.orgId },
      select: { id: true, name: true },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');

    const stock = await prisma.pharmacyDrugStock.findUnique({
      where: {
        site_id_drug_master_id: {
          site_id: site.id,
          drug_master_id: parsed.data.drug_master_id,
        },
      },
      select: { id: true, drug_master_id: true },
    });

    if (!stock) {
      return success({ site, stock: null, data: [] });
    }

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        org_id: authCtx.orgId,
        OR: [
          {
            target_type: 'PharmacyDrugStock',
            target_id: stock.id,
          },
          {
            target_type: 'PharmacySite',
            target_id: site.id,
            action: 'pharmacy_drug_stock_reviewed',
          },
        ],
      },
      orderBy: [{ created_at: 'desc' }],
      take: Math.max(parsed.data.limit * 4, parsed.data.limit),
      select: {
        id: true,
        actor_id: true,
        action: true,
        target_type: true,
        target_id: true,
        changes: true,
        created_at: true,
      },
    });

    const data = auditLogs
      .filter(
        (log) =>
          log.target_type === 'PharmacyDrugStock' ||
          includesDrugMasterId(log.changes, stock.drug_master_id),
      )
      .slice(0, parsed.data.limit);

    return success({ site, stock, data });
  },
  { permission: 'canAdmin' },
);
