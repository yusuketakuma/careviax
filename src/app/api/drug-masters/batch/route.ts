import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  buildDrugMasterBatchCacheKey,
  DRUG_MASTER_DETAIL_CACHE_TTL_MS,
  drugMasterDetailCache,
} from '@/server/services/drug-master-detail-cache';
import { z } from 'zod';

const ROUTE = '/api/drug-masters/batch';

const batchSchema = z
  .object({
    yj_codes: z.array(z.string().trim().min(1)).max(400).optional().default([]),
    drug_master_ids: z.array(z.string().trim().min(1)).max(400).optional().default([]),
  })
  .superRefine((value, ctx) => {
    const totalKeys = value.yj_codes.length + value.drug_master_ids.length;
    if (totalKeys === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['yj_codes'],
        message: 'yj_codes または drug_master_ids のいずれかが必要です',
      });
    }
  });

function buildDrugMasterBatchWhere(yjCodes: string[], drugMasterIds: string[]) {
  if (yjCodes.length > 0 && drugMasterIds.length > 0) {
    return {
      OR: [{ yj_code: { in: yjCodes } }, { id: { in: drugMasterIds } }],
    };
  }
  if (drugMasterIds.length > 0) return { id: { in: drugMasterIds } };
  return { yj_code: { in: yjCodes } };
}

async function fetchDrugMasterBatch(yjCodes: string[], drugMasterIds: string[]) {
  const drugs = await prisma.drugMaster.findMany({
    where: buildDrugMasterBatchWhere(yjCodes, drugMasterIds),
    select: {
      id: true,
      yj_code: true,
      drug_name: true,
      dosage_form: true,
      drug_price: true,
      unit: true,
      is_generic: true,
      is_narcotic: true,
      is_psychotropic: true,
      is_high_risk: true,
      is_lasa_risk: true,
      tall_man_name: true,
      lasa_group_key: true,
      max_administration_days: true,
      therapeutic_category: true,
    },
  });

  const byYjCode: Record<string, (typeof drugs)[number]> = {};
  const byDrugMasterId: Record<string, (typeof drugs)[number]> = {};
  for (const drug of drugs) {
    byYjCode[drug.yj_code] = drug;
    byDrugMasterId[drug.id] = drug;
  }

  return { ...byYjCode, by_drug_master_id: byDrugMasterId };
}

type DrugMasterBatchResponseBody = Awaited<ReturnType<typeof fetchDrugMasterBatch>>;

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = batchSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const yjCodes = Array.from(new Set(parsed.data.yj_codes));
  const drugMasterIds = Array.from(new Set(parsed.data.drug_master_ids));
  if (yjCodes.length + drugMasterIds.length > 200) {
    return validationError('入力値が不正です', {
      yj_codes: ['yj_codes と drug_master_ids は重複除去後の合計200件以内で指定してください'],
    });
  }

  const cacheKey = buildDrugMasterBatchCacheKey(yjCodes, drugMasterIds);
  const cached = drugMasterDetailCache.get<DrugMasterBatchResponseBody>(cacheKey);
  if (cached !== undefined) {
    return success(cached);
  }

  const responseBody = await runWithRequestAuthContext(ctx, () =>
    fetchDrugMasterBatch(yjCodes, drugMasterIds),
  );
  drugMasterDetailCache.set(cacheKey, responseBody, DRUG_MASTER_DETAIL_CACHE_TTL_MS);

  return success(responseBody);
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'drug_masters_batch_post_unhandled_error',
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
