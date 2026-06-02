import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import {
  computeOptimizedVisitRoute,
  type VisitRouteTravelMode,
} from '@/server/services/visit-route-engine';

const computeVisitRouteSchema = z
  .object({
    schedule_ids: z.array(z.string().trim().min(1)).max(50).default([]),
    proposal_ids: z.array(z.string().trim().min(1)).max(50).default([]),
    travel_mode: z
      .enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER'] satisfies [
        VisitRouteTravelMode,
        ...VisitRouteTravelMode[],
      ])
      .default('DRIVE'),
  })
  .superRefine((value, ctx) => {
    const totalCount = value.schedule_ids.length + value.proposal_ids.length;
    if (totalCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule_ids'],
        message: 'schedule_ids または proposal_ids のいずれかが必要です',
      });
    }
    if (totalCount > 50) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule_ids'],
        message: 'ルート計算の対象は最大 50 件です',
      });
    }
  });

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return validationError('リクエストボディが不正です');
    }

    const parsed = computeVisitRouteSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const routePlan = await withOrgContext(
      req.orgId,
      async (tx) => {
        const [schedules, proposals] = await Promise.all([
          parsed.data.schedule_ids.length > 0
            ? tx.visitSchedule.findMany({
                where: {
                  org_id: req.orgId,
                  id: { in: parsed.data.schedule_ids },
                },
                select: {
                  id: true,
                  priority: true,
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
              })
            : Promise.resolve([]),
          parsed.data.proposal_ids.length > 0
            ? tx.visitScheduleProposal.findMany({
                where: {
                  org_id: req.orgId,
                  id: { in: parsed.data.proposal_ids },
                },
                select: {
                  id: true,
                  priority: true,
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
              })
            : Promise.resolve([]),
        ]);

        const orderedItems = [
          ...parsed.data.schedule_ids
            .map((scheduleId) => schedules.find((schedule) => schedule.id === scheduleId))
            .filter((schedule): schedule is (typeof schedules)[number] => Boolean(schedule))
            .map((schedule) => ({
              id: schedule.id,
              route_id: schedule.id,
              patient_name: schedule.case_.patient.name,
              priority: schedule.priority,
              residence: schedule.case_.patient.residences[0] ?? null,
              site: schedule.site,
            })),
          ...parsed.data.proposal_ids
            .map((proposalId) => proposals.find((proposal) => proposal.id === proposalId))
            .filter((proposal): proposal is (typeof proposals)[number] => Boolean(proposal))
            .map((proposal) => ({
              id: proposal.id,
              route_id: `proposal:${proposal.id}`,
              patient_name: proposal.case_.patient.name,
              priority: proposal.priority,
              residence: proposal.case_.patient.residences[0] ?? null,
              site: proposal.site,
            })),
        ];

        if (orderedItems.length === 0) {
          return computeOptimizedVisitRoute({
            origin: null,
            travelMode: parsed.data.travel_mode,
            waypoints: [],
          });
        }

        const originSite = orderedItems[0]?.site ?? null;
        const sameSite = orderedItems.every((item) => item.site?.id === originSite?.id);

        const origin =
          sameSite && originSite?.lat != null && originSite.lng != null
            ? {
                lat: originSite.lat,
                lng: originSite.lng,
                label: originSite.name,
              }
            : null;

        const routableItems = orderedItems.filter((item) => {
          return item.residence?.lat != null && item.residence.lng != null;
        });

        const plan = await computeOptimizedVisitRoute({
          origin,
          travelMode: parsed.data.travel_mode,
          waypoints: routableItems.map((item) => {
            const residence = item.residence!;
            return {
              scheduleId: item.route_id,
              patientName: item.patient_name,
              address: residence.address,
              lat: residence.lat!,
              lng: residence.lng!,
              priority: item.priority,
            };
          }),
        });

        if (!sameSite && orderedItems.length > 0) {
          return {
            ...plan,
            note: plan.note
              ? `複数拠点が混在しているため先頭拠点を起点にできません / ${plan.note}`
              : '複数拠点が混在しているため先頭拠点を起点にできません',
          };
        }

        if (routableItems.length !== orderedItems.length) {
          const missing = orderedItems
            .filter((item) => !routableItems.some((candidate) => candidate.id === item.id))
            .map((item) => item.patient_name);

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
