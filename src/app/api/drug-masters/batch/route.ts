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
import { z } from 'zod';

const ROUTE = '/api/drug-masters/batch';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

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

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

function buildDrugMasterBatchWhere(yjCodes: string[], drugMasterIds: string[]) {
  if (yjCodes.length > 0 && drugMasterIds.length > 0) {
    return {
      OR: [{ yj_code: { in: yjCodes } }, { id: { in: drugMasterIds } }],
    };
  }
  if (drugMasterIds.length > 0) return { id: { in: drugMasterIds } };
  return { yj_code: { in: yjCodes } };
}

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

  const drugs = await runWithRequestAuthContext(ctx, () =>
    prisma.drugMaster.findMany({
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
    }),
  );

  const byYjCode: Record<string, (typeof drugs)[number]> = {};
  const byDrugMasterId: Record<string, (typeof drugs)[number]> = {};
  for (const drug of drugs) {
    byYjCode[drug.yj_code] = drug;
    byDrugMasterId[drug.id] = drug;
  }

  return success({ ...byYjCode, by_drug_master_id: byDrugMasterId });
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('drug_masters_batch_post_unhandled_error', undefined, {
        event: 'drug_masters_batch_post_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
