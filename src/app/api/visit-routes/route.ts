import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import {
  computeOptimizedVisitRoute,
  type VisitRouteTravelMode,
} from '@/server/services/google-routes';

const computeVisitRouteSchema = z.object({
  schedule_ids: z.array(z.string().trim().min(1)).min(1).max(50),
  travel_mode: z
    .enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER'] satisfies [VisitRouteTravelMode, ...VisitRouteTravelMode[]])
    .default('DRIVE'),
});

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) {
      return validationError('リクエストボディが不正です');
    }

    const parsed = computeVisitRouteSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const routePlan = await withOrgContext(
      req.orgId,
      async (tx) => {
        const schedules = await tx.visitSchedule.findMany({
          where: {
            org_id: req.orgId,
            id: { in: parsed.data.schedule_ids },
          },
          select: {
            id: true,
            scheduled_date: true,
            site: {
              select: {
                id: true,
                name: true,
                lat: true,
                lng: true,
              },
            },
            case_: {
              select: {
                patient: {
                  select: {
                    name: true,
                    residences: {
                      where: { is_primary: true },
                      select: {
                        address: true,
                        lat: true,
                        lng: true,
                      },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        });

        const orderedSchedules = parsed.data.schedule_ids
          .map((scheduleId) => schedules.find((schedule) => schedule.id === scheduleId))
          .filter((schedule): schedule is (typeof schedules)[number] => Boolean(schedule));

        if (orderedSchedules.length === 0) {
          return computeOptimizedVisitRoute({
            origin: null,
            travelMode: parsed.data.travel_mode,
            waypoints: [],
          });
        }

        const originSite = orderedSchedules[0]?.site ?? null;
        const sameSite = orderedSchedules.every(
          (schedule) => schedule.site?.id === originSite?.id,
        );

        const origin =
          sameSite && originSite?.lat != null && originSite.lng != null
            ? {
                lat: originSite.lat,
                lng: originSite.lng,
                label: originSite.name,
              }
            : null;

        const routableSchedules = orderedSchedules.filter((schedule) => {
          const residence = schedule.case_.patient.residences[0];
          return residence?.lat != null && residence.lng != null;
        });

        const plan = await computeOptimizedVisitRoute({
          origin,
          travelMode: parsed.data.travel_mode,
          waypoints: routableSchedules.map((schedule) => {
            const residence = schedule.case_.patient.residences[0]!;
            return {
              scheduleId: schedule.id,
              patientName: schedule.case_.patient.name,
              address: residence.address,
              lat: residence.lat!,
              lng: residence.lng!,
            };
          }),
        });

        if (!sameSite && orderedSchedules.length > 0) {
          return {
            ...plan,
            note: plan.note
              ? `複数拠点が混在しているため先頭拠点を起点にできません / ${plan.note}`
              : '複数拠点が混在しているため先頭拠点を起点にできません',
          };
        }

        if (routableSchedules.length !== orderedSchedules.length) {
          const missing = orderedSchedules
            .filter((schedule) => !routableSchedules.some((item) => item.id === schedule.id))
            .map((schedule) => schedule.case_.patient.name);

          return {
            ...plan,
            note: plan.note
              ? `${plan.note} / 座標未設定: ${missing.join('、')}`
              : `座標未設定のため経路計算に含めていない患者: ${missing.join('、')}`,
          };
        }

        return plan;
      },
      { requestContext: req },
    );

    return success(routePlan);
  },
  {
    permission: 'canVisit',
    message: '訪問ルートの閲覧権限がありません',
  },
);
