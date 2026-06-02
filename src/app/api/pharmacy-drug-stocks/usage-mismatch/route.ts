import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';

const usageMismatchQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  days: boundedIntegerSearchParam('days', 1, 365, 90),
  draft_limit: boundedIntegerSearchParam('draft_limit', 1, 1000, 500),
  frequent_threshold: boundedIntegerSearchParam('frequent_threshold', 1, 100, 2),
  limit: boundedIntegerSearchParam('limit', 1, 100, 25),
});

type ParsedMedication = {
  drugCode?: unknown;
  drugName?: unknown;
};

const mismatchDrugSelect = {
  id: true,
  yj_code: true,
  drug_name: true,
  generic_name: true,
  drug_price: true,
  unit: true,
  is_generic: true,
} satisfies Prisma.DrugMasterSelect;

const mismatchStockSelect = {
  id: true,
  drug_master_id: true,
  reorder_point: true,
  updated_at: true,
  drug_master: {
    select: mismatchDrugSelect,
  },
} satisfies Prisma.PharmacyDrugStockSelect;

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function readMedications(parsedData: unknown): ParsedMedication[] {
  const medications = readJsonObject(parsedData)?.medications;
  if (!Array.isArray(medications)) return [];
  return medications.flatMap((medication): ParsedMedication[] => {
    const record = readJsonObject(medication);
    if (!record) return [];
    return [{ drugCode: record.drugCode, drugName: record.drugName }];
  });
}

function normalizeCode(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeName(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const parsed = parseSearchParams(usageMismatchQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: parsed.data.site_id, org_id: authCtx.orgId },
      select: { id: true, name: true },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');

    const since = addDays(new Date(), -parsed.data.days);
    const [drafts, stockedRows] = await Promise.all([
      prisma.qrScanDraft.findMany({
        where: {
          org_id: authCtx.orgId,
          site_id: site.id,
          status: { not: 'discarded' },
          created_at: { gte: since },
        },
        orderBy: [{ created_at: 'desc' }],
        take: parsed.data.draft_limit,
        select: {
          id: true,
          parsed_data: true,
          created_at: true,
        },
      }),
      prisma.pharmacyDrugStock.findMany({
        where: {
          org_id: authCtx.orgId,
          site_id: site.id,
          is_stocked: true,
        },
        select: mismatchStockSelect,
      }),
    ]);

    const usageByKey = new Map<
      string,
      { drugCode: string; drugName: string; count: number; lastSeenAt: Date }
    >();
    for (const draft of drafts) {
      for (const medication of readMedications(draft.parsed_data)) {
        const drugCode = normalizeCode(medication.drugCode).slice(0, 12);
        const drugName = normalizeName(medication.drugName);
        if (!drugCode && !drugName) continue;
        const key = drugCode || `name:${drugName}`;
        const current = usageByKey.get(key);
        if (current) {
          current.count += 1;
          if (draft.created_at > current.lastSeenAt) current.lastSeenAt = draft.created_at;
        } else {
          usageByKey.set(key, {
            drugCode,
            drugName,
            count: 1,
            lastSeenAt: draft.created_at,
          });
        }
      }
    }

    const usedCodes = [...usageByKey.values()].map((usage) => usage.drugCode).filter(Boolean);
    const usedNames = [...usageByKey.values()]
      .filter((usage) => !usage.drugCode && usage.drugName)
      .map((usage) => usage.drugName);
    const matchedDrugs =
      usedCodes.length > 0 || usedNames.length > 0
        ? await prisma.drugMaster.findMany({
            where: {
              OR: [
                ...(usedCodes.length > 0 ? [{ yj_code: { in: usedCodes } }] : []),
                ...(usedNames.length > 0 ? [{ drug_name: { in: usedNames } }] : []),
              ],
            },
            select: {
              ...mismatchDrugSelect,
            },
          })
        : [];
    const drugByYj = new Map(matchedDrugs.map((drug) => [drug.yj_code, drug]));
    const drugByName = new Map(matchedDrugs.map((drug) => [drug.drug_name, drug]));
    const stockedDrugIds = new Set(stockedRows.map((stock) => stock.drug_master_id));
    const usedDrugIds = new Set<string>();

    const usageRows = [...usageByKey.values()].map((usage) => {
      const drug = usage.drugCode ? drugByYj.get(usage.drugCode) : drugByName.get(usage.drugName);
      if (drug) usedDrugIds.add(drug.id);
      return {
        ...usage,
        drug,
        inFormulary: drug ? stockedDrugIds.has(drug.id) : false,
      };
    });
    const medicationLineCount = usageRows.reduce((sum, usage) => sum + usage.count, 0);
    const matchedUsageCount = usageRows.filter((usage) => usage.drug).length;
    const unmatchedUsageRows = usageRows.filter((usage) => !usage.drug);
    const frequentUnstockedAll = usageRows
      .filter(
        (usage) =>
          usage.count >= parsed.data.frequent_threshold &&
          (!usage.drug || !stockedDrugIds.has(usage.drug.id)),
      )
      .sort((a, b) => b.count - a.count || b.lastSeenAt.getTime() - a.lastSeenAt.getTime());

    const unusedStockedAll = stockedRows
      .filter((stock) => !usedDrugIds.has(stock.drug_master_id))
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
    const frequentUnstocked = frequentUnstockedAll.slice(0, parsed.data.limit);
    const unusedStocked = unusedStockedAll.slice(0, parsed.data.limit);

    return success({
      site,
      checked_at: new Date().toISOString(),
      period: {
        since: since.toISOString(),
        until: new Date().toISOString(),
      },
      thresholds: {
        days: parsed.data.days,
        frequent_threshold: parsed.data.frequent_threshold,
        draft_limit: parsed.data.draft_limit,
        limit: parsed.data.limit,
      },
      totals: {
        scanned_draft_count: drafts.length,
        used_drug_count: usageByKey.size,
        medication_line_count: medicationLineCount,
        matched_drug_count: matchedUsageCount,
        unmatched_drug_count: unmatchedUsageRows.length,
        stocked_count: stockedRows.length,
        frequent_unstocked_count: frequentUnstockedAll.length,
        unused_stocked_count: unusedStockedAll.length,
        displayed_frequent_unstocked_count: frequentUnstocked.length,
        displayed_unused_stocked_count: unusedStocked.length,
      },
      frequent_unstocked: frequentUnstocked.map((usage) => ({
        drug_code: usage.drugCode || null,
        drug_name: usage.drugName || usage.drug?.drug_name || null,
        count: usage.count,
        last_seen_at: usage.lastSeenAt.toISOString(),
        matched_drug: usage.drug ?? null,
      })),
      unused_stocked: unusedStocked,
      unmatched_prescribed: unmatchedUsageRows
        .sort((a, b) => b.count - a.count || b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
        .slice(0, parsed.data.limit)
        .map((usage) => ({
          drug_code: usage.drugCode || null,
          drug_name: usage.drugName || null,
          count: usage.count,
          last_seen_at: usage.lastSeenAt.toISOString(),
        })),
    });
  },
  { permission: 'canAdmin' },
);
