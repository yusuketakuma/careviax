import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { annotateDispenseTask, sortDispenseTasks } from '@/server/services/dispense-task-list';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/dispense-queue';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canDispense',
    message: '調剤キューの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const now = new Date();
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
    const tasks = await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.dispenseTask.findMany({
          where: {
            org_id: ctx.orgId,
            status: { in: ['pending', 'in_progress'] },
            ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
          },
          orderBy: [
            {
              priority: 'asc', // emergency < urgent < normal sorts ascending with custom mapping below
            },
            { due_date: 'asc' },
            { created_at: 'asc' },
          ],
          include: {
            results: {
              select: {
                id: true,
                line_id: true,
                actual_drug_name: true,
                actual_drug_code: true,
                actual_quantity: true,
                actual_unit: true,
                discrepancy_reason: true,
                carry_type: true,
                special_notes: true,
              },
            },
            cycle: {
              select: {
                id: true,
                patient_id: true,
                overall_status: true,
                case_: {
                  select: {
                    id: true,
                    patient: {
                      select: {
                        id: true,
                        name: true,
                        name_kana: true,
                        residences: {
                          where: { is_primary: true },
                          take: 1,
                          select: {
                            building_id: true,
                            address: true,
                          },
                        },
                      },
                    },
                  },
                },
                inquiries: {
                  where: {
                    OR: [{ result: null }, { result: 'pending' }],
                  },
                  orderBy: [{ inquired_at: 'desc' }, { created_at: 'desc' }],
                  select: {
                    id: true,
                    line_id: true,
                    reason: true,
                    inquiry_to_physician: true,
                    inquiry_content: true,
                    result: true,
                    proposal_origin: true,
                    residual_adjustment: true,
                    change_detail: true,
                    line: {
                      select: {
                        id: true,
                        line_number: true,
                        drug_name: true,
                      },
                    },
                  },
                },
                prescription_intakes: {
                  orderBy: { created_at: 'desc' },
                  take: 1,
                  select: {
                    id: true,
                    prescribed_date: true,
                    prescriber_name: true,
                    prescriber_institution: true,
                    lines: {
                      select: {
                        id: true,
                        drug_name: true,
                        drug_code: true,
                        dose: true,
                        frequency: true,
                        days: true,
                        quantity: true,
                        unit: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    return success({
      data: sortDispenseTasks(tasks, 'created_at').map((task) => annotateDispenseTask(task, now)),
    });
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('dispense_queue_get_unhandled_error', undefined, {
        event: 'dispense_queue_get_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
