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

const batchSchema = z.object({
  yj_codes: z.array(z.string().trim().min(1)).min(1).max(200),
});

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
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
  const drugs = await runWithRequestAuthContext(ctx, () =>
    prisma.drugMaster.findMany({
      where: { yj_code: { in: yjCodes } },
      select: {
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

  const byCode = Object.fromEntries(drugs.map((d) => [d.yj_code, d]));

  return success(byCode);
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
