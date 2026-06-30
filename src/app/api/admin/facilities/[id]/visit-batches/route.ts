import { unstable_rethrow } from 'next/navigation';
import { internalError, notFound, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';

const FACILITY_VISIT_BATCH_HISTORY_LIMIT = 20;

const authenticatedGET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const facility = await prisma.facility.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!facility) return notFound('施設が見つかりません');

    const batchWhere = {
      org_id: ctx.orgId,
      facility_id: id,
    };
    const [totalCount, batches] = await Promise.all([
      prisma.facilityVisitBatch.count({ where: batchWhere }),
      prisma.facilityVisitBatch.findMany({
        where: batchWhere,
        orderBy: [{ scheduled_date: 'desc' }, { created_at: 'desc' }],
        take: FACILITY_VISIT_BATCH_HISTORY_LIMIT,
        select: {
          id: true,
          scheduled_date: true,
          pharmacist_id: true,
          patient_ids: true,
          estimated_duration: true,
          created_at: true,
          visit_schedules: {
            orderBy: { route_order: 'asc' },
            select: {
              id: true,
              route_order: true,
              case_: {
                select: {
                  patient: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);
    const visibleCount = batches.length;

    return success({
      data: batches.map((batch) => ({
        id: batch.id,
        scheduled_date: batch.scheduled_date.toISOString(),
        pharmacist_id: batch.pharmacist_id,
        patient_count: Array.isArray(batch.patient_ids) ? batch.patient_ids.length : 0,
        estimated_duration: batch.estimated_duration,
        created_at: batch.created_at.toISOString(),
        visits: batch.visit_schedules.map((schedule) => ({
          schedule_id: schedule.id,
          route_order: schedule.route_order,
          patient_id: schedule.case_.patient.id,
          patient_name: schedule.case_.patient.name,
        })),
      })),
      meta: {
        limit: FACILITY_VISIT_BATCH_HISTORY_LIMIT,
        total_count: totalCount,
        visible_count: visibleCount,
        hidden_count: Math.max(totalCount - visibleCount, 0),
        count_basis: 'facility_visit_batches_for_facility',
        filters_applied: {
          facility_id: id,
        },
      },
    });
  },
  {
    permission: 'canVisit',
    message: '施設訪問履歴の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
