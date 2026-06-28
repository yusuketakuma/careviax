import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { success, validationError, notFound, internalError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { z } from 'zod';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { verifyDispenseBarcodeForLine } from '@/lib/dispensing/dispense-barcode-verification';

const ROUTE = '/api/dispense-tasks/[id]/verify-barcode';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

const verifyBarcodeSchema = z.object({
  barcode: z.string().min(1, 'バーコードは必須です'),
  line_id: z.string().min(1, '処方明細IDは必須です'),
});

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

async function authenticatedPOST(req: NextRequest, routeContext: AuthRouteContext<{ id: string }>) {
  const authResult = await requireAuthContext(req, {
    permission: 'canDispense',
    message: 'バーコード照合権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('調剤タスクIDが不正です');

    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = verifyBarcodeSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const task = await prisma.dispenseTask.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
        ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
      },
      select: { id: true, cycle_id: true },
    });
    if (!task) return notFound('タスクが見つかりません');

    const { barcode, line_id } = parsed.data;

    const line = await prisma.prescriptionLine.findFirst({
      where: {
        id: line_id,
        org_id: ctx.orgId,
        intake: {
          cycle_id: task.cycle_id,
        },
      },
      select: {
        id: true,
        drug_code: true,
        drug_name: true,
      },
    });
    if (!line) return notFound('処方明細が見つかりません');

    const verification = await verifyDispenseBarcodeForLine({
      client: prisma,
      line,
      barcode,
    });

    return success({
      match: verification.match,
      decoded: verification.decoded,
      expected: verification.expected,
      warnings: verification.warnings,
    });
  });
}

export async function POST(req: NextRequest, routeContext: AuthRouteContext<{ id: string }>) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('dispense_task_verify_barcode_unhandled_error', undefined, {
        event: 'dispense_task_verify_barcode_unhandled_error',
        route: ROUTE,
        method: 'POST',
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
