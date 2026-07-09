import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';

const historyQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  drug_master_id: z.string().trim().min(1, 'drug_master_id は必須です'),
  limit: boundedIntegerSearchParam('limit', 1, 100, 25),
});

function includesDrugMasterId(changes: unknown, drugMasterId: string) {
  const data = readJsonObject(changes);
  if (!data) return false;

  if (data.drug_master_id === drugMasterId) return true;
  const drugMasterIds = data.drug_master_ids;
  if (Array.isArray(drugMasterIds) && drugMasterIds.includes(drugMasterId)) return true;
  const rows = data.rows;
  return (
    Array.isArray(rows) && rows.some((row) => readJsonObject(row)?.drug_master_id === drugMasterId)
  );
}

const authenticatedGET = withAuthContext(
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

    // RLS-RAW-READ-GUARD-001: add an explicit org_id filter so this raw read
    // (outside withOrgContext) is org-scoped in the app layer, not just via the
    // parent site lookup. findUnique -> findFirst because org_id is not part of
    // the unique key.
    const stock = await prisma.pharmacyDrugStock.findFirst({
      where: {
        org_id: authCtx.orgId,
        site_id: site.id,
        drug_master_id: parsed.data.drug_master_id,
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
            action: {
              in: ['pharmacy_drug_stock_reviewed', 'pharmacy_drug_stock_bulk_import_summary'],
            },
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

export const GET: typeof authenticatedGET = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedGET(req, routeContext));
