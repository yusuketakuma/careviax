import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { withOrgContext } from '@/lib/db/rls';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { readJsonResponseBody } from '@/lib/api/response-body';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { bulkPharmacistShiftSchema, toShiftTimeValue } from '@/lib/validations/pharmacist-shift';

const ROUTE = '/api/pharmacist-shifts/bulk';

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'シフト情報の一括作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = bulkPharmacistShiftSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    for (const [index, row] of parsed.data.rows.entries()) {
      const refResult = await validateOrgReferences(ctx.orgId, {
        site_id: row.site_id,
        pharmacist_id: row.user_id,
      });
      if (!refResult.ok) {
        return validationError(`${index + 2} 行目の参照先が不正です`, {
          row: index + 2,
          details: (await readJsonResponseBody(refResult.response)) ?? undefined,
        });
      }
    }

    const applied = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        let count = 0;
        for (const row of parsed.data.rows) {
          const { date, available_from, available_to, ...rest } = row;
          const availableFromValue = toShiftTimeValue(available_from);
          const availableToValue = toShiftTimeValue(available_to);
          await tx.pharmacistShift.upsert({
            where: { user_id_date: { user_id: rest.user_id, date: new Date(date) } },
            create: {
              org_id: ctx.orgId,
              date: new Date(date),
              ...(availableFromValue !== undefined ? { available_from: availableFromValue } : {}),
              ...(availableToValue !== undefined ? { available_to: availableToValue } : {}),
              ...rest,
            },
            update: {
              site_id: rest.site_id,
              ...(availableFromValue !== undefined ? { available_from: availableFromValue } : {}),
              ...(availableToValue !== undefined ? { available_to: availableToValue } : {}),
              available: rest.available,
              note: rest.note,
            },
          });
          count += 1;
        }
        return count;
      },
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    return success({ data: { applied_count: applied } }, 201);
  });
}

export async function POST(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'pharmacist_shifts_bulk_post_unhandled_error',
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
