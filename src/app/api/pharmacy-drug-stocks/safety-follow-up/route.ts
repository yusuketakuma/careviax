import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';

const safetyFollowUpSchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  queue: z.enum(['all', 'high_risk', 'lasa_risk', 'controlled']).default('all'),
  due_in_days: z.number().int().min(1).max(365).default(30),
  reason: z.string().trim().max(500).optional(),
  dry_run: z.boolean().default(false),
});

function buildSafetyWhere(queue: z.infer<typeof safetyFollowUpSchema>['queue']) {
  if (queue === 'high_risk') return { is_high_risk: true };
  if (queue === 'lasa_risk') return { is_lasa_risk: true };
  if (queue === 'controlled') return { OR: [{ is_narcotic: true }, { is_psychotropic: true }] };
  return {
    OR: [
      { is_high_risk: true },
      { is_lasa_risk: true },
      { is_narcotic: true },
      { is_psychotropic: true },
    ],
  };
}

export const POST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = safetyFollowUpSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: parsed.data.site_id, org_id: authCtx.orgId },
      select: { id: true, name: true },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');

    const safetyWhere = buildSafetyWhere(parsed.data.queue);
    const targetWhere = {
      org_id: authCtx.orgId,
      site_id: site.id,
      is_stocked: true,
      OR: [{ follow_up_status: null }, { follow_up_status: 'active' }],
      drug_master: safetyWhere,
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const existingUnresolvedWhere = {
      org_id: authCtx.orgId,
      site_id: site.id,
      is_stocked: true,
      AND: [
        { follow_up_status: { not: null } },
        { follow_up_status: { notIn: ['active', 'resolved', ''] } },
        { drug_master: safetyWhere },
      ],
    } satisfies Prisma.PharmacyDrugStockWhereInput;

    const [targetStocks, skippedUnresolvedCount] = await Promise.all([
      prisma.pharmacyDrugStock.findMany({
        where: targetWhere,
        select: { id: true, drug_master_id: true },
        take: 1000,
      }),
      prisma.pharmacyDrugStock.count({ where: existingUnresolvedWhere }),
    ]);

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + parsed.data.due_in_days);
    const reason =
      parsed.data.reason ??
      (parsed.data.queue === 'all'
        ? '安全属性のある採用品の定期確認'
        : '安全属性キューからの採用品確認');

    if (parsed.data.dry_run || targetStocks.length === 0) {
      return success({
        site,
        queue: parsed.data.queue,
        matchedCount: targetStocks.length,
        updatedCount: 0,
        skippedUnresolvedCount,
        dueDate: dueDate.toISOString(),
        dryRun: parsed.data.dry_run,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.pharmacyDrugStock.updateMany({
        where: {
          id: { in: targetStocks.map((stock) => stock.id) },
          org_id: authCtx.orgId,
        },
        data: {
          follow_up_status: 'needs_review',
          follow_up_reason: reason,
          follow_up_due_date: dueDate,
          follow_up_resolved_at: null,
        },
      });

      await createAuditLogEntry(tx, authCtx, {
        action: 'pharmacy_drug_stock_safety_follow_up_created',
        targetType: 'PharmacySite',
        targetId: site.id,
        changes: {
          site_id: site.id,
          queue: parsed.data.queue,
          due_in_days: parsed.data.due_in_days,
          due_date: dueDate.toISOString(),
          reason,
          matched_count: targetStocks.length,
          updated_count: updateResult.count,
          skipped_unresolved_count: skippedUnresolvedCount,
          drug_master_ids: targetStocks.map((stock) => stock.drug_master_id),
        },
      });

      return updateResult;
    });

    return success({
      site,
      queue: parsed.data.queue,
      matchedCount: targetStocks.length,
      updatedCount: result.count,
      skippedUnresolvedCount,
      dueDate: dueDate.toISOString(),
      dryRun: false,
    });
  },
  { permission: 'canAdmin' },
);
