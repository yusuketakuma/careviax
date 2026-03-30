import { notFound, success } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';

export const GET = withAuthContext<{ id: string }>(async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;

  const facility = await prisma.facility.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!facility) return notFound('施設が見つかりません');

  const batches = await prisma.facilityVisitBatch.findMany({
    where: {
      org_id: ctx.orgId,
      facility_id: id,
    },
    orderBy: [{ scheduled_date: 'desc' }, { created_at: 'desc' }],
    take: 20,
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
  });

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
  });
}, {
  permission: 'canVisit',
  message: '施設訪問履歴の閲覧権限がありません',
});
