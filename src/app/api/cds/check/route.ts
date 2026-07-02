import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { checkDispenseAlerts } from '@/server/cds/checker';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { z } from 'zod';

const ROUTE = '/api/cds/check';

const cdsCheckSchema = z.object({
  cycleId: z.string().min(1),
  patientId: z.string().min(1).optional(),
});

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '処方安全チェックの実行権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = cdsCheckSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { cycleId } = parsed.data;

    // Verify the cycle belongs to this org
    const cycle = await prisma.medicationCycle.findFirst({
      where: { id: cycleId, org_id: ctx.orgId },
      select: { id: true, patient_id: true },
    });

    if (!cycle) return notFound('指定されたサイクルが見つかりません');

    // Use the patientId from the cycle for security (prevent cross-patient access)
    const alerts = await checkDispenseAlerts(ctx.orgId, cycleId, cycle.patient_id);

    return success({ alerts });
  });
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'cds_check_post_unhandled_error',
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
