import { z } from 'zod';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import {
  buildVisitScheduleAssignmentWhere,
  buildVisitScheduleProposalAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import {
  computeOptimizedVisitRoute,
  type VisitRouteTravelMode,
} from '@/server/services/visit-route-engine';

const computeVisitRouteSchema = z
  .object({
    schedule_ids: z.array(z.string().trim().min(1)).max(50).default([]),
    proposal_ids: z.array(z.string().trim().min(1)).max(50).default([]),
    // 緊急割込時に「移動させない」確定済み訪問の route_id 群(任意)。
    // schedule は id、proposal は `proposal:<id>` を指定する。p0_20「案1: 確定患者の移動なし」用。
    locked_schedule_ids: z.array(z.string().trim().min(1)).max(50).default([]),
    vehicle_resource_id: z.string().trim().min(1).optional(),
    vehicle_resource: z
      .object({
        vehicle_id: z.string().trim().min(1).optional(),
        label: z.string().trim().min(1).optional(),
        max_stops: z.number().int().min(1).max(50).optional(),
        max_route_duration_minutes: z
          .number()
          .int()
          .min(1)
          .max(24 * 60)
          .optional(),
      })
      .optional(),
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
    if (value.vehicle_resource_id && value.vehicle_resource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicle_resource'],
        message: 'vehicle_resource_id と vehicle_resource は同時に指定できません',
      });
    }
    if (value.vehicle_resource?.max_stops && totalCount > value.vehicle_resource.max_stops) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicle_resource', 'max_stops'],
        message: `この車両リソースで訪問できる件数は最大 ${value.vehicle_resource.max_stops} 件です`,
      });
    }
  });

function appendRouteNote(note: string | null, next: string) {
  return note ? `${note} / ${next}` : next;
}

type RoutePlanLookupError =
  | { error: 'route_target_not_found' }
  | { error: 'vehicle_resource_not_found' }
  | { error: 'vehicle_resource_site_mismatch'; message: string }
  | { error: 'vehicle_resource_capacity_exceeded'; message: string };

function hasRoutePlanLookupError(value: unknown): value is RoutePlanLookupError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    (value.error === 'route_target_not_found' ||
      value.error === 'vehicle_resource_not_found' ||
      value.error === 'vehicle_resource_site_mismatch' ||
      value.error === 'vehicle_resource_capacity_exceeded')
  );
}

export const POST = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return validationError('リクエストボディが不正です');
    }

    const parsed = computeVisitRouteSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const routePlan = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const scheduleAssignmentWhere = buildVisitScheduleAssignmentWhere(ctx);
        const proposalAssignmentWhere = buildVisitScheduleProposalAssignmentWhere(ctx);

        const [schedules, proposals, persistedVehicleResource] = await Promise.all([
          parsed.data.schedule_ids.length > 0
            ? tx.visitSchedule.findMany({
                where: {
                  org_id: ctx.orgId,
                  id: { in: parsed.data.schedule_ids },
                  ...(scheduleAssignmentWhere ? { AND: [scheduleAssignmentWhere] } : {}),
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
                  org_id: ctx.orgId,
                  id: { in: parsed.data.proposal_ids },
                  ...(proposalAssignmentWhere ? { AND: [proposalAssignmentWhere] } : {}),
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
          parsed.data.vehicle_resource_id
            ? tx.visitVehicleResource.findFirst({
                where: {
                  org_id: ctx.orgId,
                  id: parsed.data.vehicle_resource_id,
                  available: true,
                },
                select: {
                  id: true,
                  site_id: true,
                  label: true,
                  travel_mode: true,
                  max_stops: true,
                  max_route_duration_minutes: true,
                },
              })
            : Promise.resolve(null),
        ]);

        if (parsed.data.vehicle_resource_id && !persistedVehicleResource) {
          return { error: 'vehicle_resource_not_found' } satisfies RoutePlanLookupError;
        }

        const effectiveVehicleResource = persistedVehicleResource
          ? {
              vehicle_id: persistedVehicleResource.id,
              label: persistedVehicleResource.label,
              max_stops: persistedVehicleResource.max_stops,
              max_route_duration_minutes: persistedVehicleResource.max_route_duration_minutes,
            }
          : parsed.data.vehicle_resource;
        const effectiveTravelMode =
          persistedVehicleResource?.travel_mode ?? parsed.data.travel_mode;

        if (
          effectiveVehicleResource?.max_stops &&
          parsed.data.schedule_ids.length + parsed.data.proposal_ids.length >
            effectiveVehicleResource.max_stops
        ) {
          const vehicleLabel =
            effectiveVehicleResource.label ??
            effectiveVehicleResource.vehicle_id ??
            '選択中の社用車';
          return {
            error: 'vehicle_resource_capacity_exceeded',
            message: `${vehicleLabel} で訪問できる件数は最大 ${effectiveVehicleResource.max_stops} 件です`,
          } satisfies RoutePlanLookupError;
        }

        const foundScheduleIds = new Set(schedules.map((schedule) => schedule.id));
        const foundProposalIds = new Set(proposals.map((proposal) => proposal.id));
        const hasMissingSchedule = parsed.data.schedule_ids.some(
          (scheduleId) => !foundScheduleIds.has(scheduleId),
        );
        const hasMissingProposal = parsed.data.proposal_ids.some(
          (proposalId) => !foundProposalIds.has(proposalId),
        );
        if (hasMissingSchedule || hasMissingProposal) {
          return { error: 'route_target_not_found' } satisfies RoutePlanLookupError;
        }

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
            travelMode: effectiveTravelMode,
            waypoints: [],
          });
        }

        const originSite = orderedItems[0]?.site ?? null;
        const sameSite = orderedItems.every((item) => item.site?.id === originSite?.id);

        if (persistedVehicleResource) {
          if (!sameSite || !originSite?.id) {
            return {
              error: 'vehicle_resource_site_mismatch',
              message:
                '車両リソースを指定する場合は、同一拠点の訪問予定または候補だけを選択してください',
            } satisfies RoutePlanLookupError;
          }
          if (persistedVehicleResource.site_id !== originSite.id) {
            return {
              error: 'vehicle_resource_site_mismatch',
              message: '選択した車両リソースは訪問予定の拠点では利用できません',
            } satisfies RoutePlanLookupError;
          }
        }

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

        // 「移動させない」確定済み訪問。route_id(schedule の id / proposal:<id>)で照合し、
        // ルート可能な対象だけに限定する。1件以上あればヒューリスティック経路で先頭に固定される。
        const requestedLockedIds = new Set(parsed.data.locked_schedule_ids);
        const lockedScheduleIds = routableItems
          .map((item) => item.route_id)
          .filter((routeId) => requestedLockedIds.has(routeId));

        const plan = await computeOptimizedVisitRoute({
          origin,
          travelMode: effectiveTravelMode,
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
          ...(lockedScheduleIds.length > 0 ? { lockedScheduleIds } : {}),
        });

        const vehicleResource = effectiveVehicleResource;
        const vehicleLabel =
          vehicleResource?.label ?? vehicleResource?.vehicle_id ?? '選択中の社用車';
        const vehicleConstraintExceeded =
          vehicleResource?.max_route_duration_minutes != null &&
          plan.totalDurationSeconds != null &&
          plan.totalDurationSeconds > vehicleResource.max_route_duration_minutes * 60;
        const vehicleConstraintUnverified =
          vehicleResource?.max_route_duration_minutes != null && plan.totalDurationSeconds == null;
        const planWithVehicleResource = vehicleResource
          ? {
              ...plan,
              ...(vehicleConstraintExceeded
                ? {
                    status: 'unavailable' as const,
                    note: appendRouteNote(
                      plan.note,
                      `${vehicleLabel} の稼働上限 ${vehicleResource.max_route_duration_minutes}分を超えています`,
                    ),
                  }
                : vehicleConstraintUnverified
                  ? {
                      note: appendRouteNote(
                        plan.note,
                        `${vehicleLabel} の稼働上限は経路時間未計算のため未確認です`,
                      ),
                    }
                  : {
                      note: appendRouteNote(
                        plan.note,
                        `${vehicleLabel} の車両リソース条件を確認済み`,
                      ),
                    }),
              vehicle_resource: {
                vehicle_id: vehicleResource.vehicle_id ?? null,
                label: vehicleLabel,
                max_stops: vehicleResource.max_stops ?? null,
                max_route_duration_minutes: vehicleResource.max_route_duration_minutes ?? null,
                stop_count: orderedItems.length,
                route_duration_minutes:
                  plan.totalDurationSeconds == null
                    ? null
                    : Math.ceil(plan.totalDurationSeconds / 60),
                constraint_status: vehicleConstraintExceeded
                  ? 'exceeded'
                  : vehicleConstraintUnverified
                    ? 'unverified'
                    : 'ok',
              },
            }
          : plan;

        if (!sameSite && orderedItems.length > 0) {
          return {
            ...planWithVehicleResource,
            note: appendRouteNote(
              planWithVehicleResource.note,
              '複数拠点が混在しているため先頭拠点を起点にできません',
            ),
          };
        }

        if (routableItems.length !== orderedItems.length) {
          const missing = orderedItems
            .filter((item) => !routableItems.some((candidate) => candidate.id === item.id))
            .map((item) => item.patient_name);

          return {
            ...planWithVehicleResource,
            note: appendRouteNote(
              planWithVehicleResource.note,
              `座標未設定: ${missing.join('、')}`,
            ),
          };
        }

        return planWithVehicleResource;
      },
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    if (hasRoutePlanLookupError(routePlan)) {
      if (routePlan.error === 'vehicle_resource_not_found') {
        return notFound('車両リソースが見つかりません');
      }
      if (routePlan.error === 'vehicle_resource_capacity_exceeded') {
        return validationError(routePlan.message);
      }
      if (routePlan.error === 'vehicle_resource_site_mismatch') {
        return validationError(routePlan.message);
      }
      return notFound('訪問ルートの対象が見つかりません');
    }

    return success(routePlan);
  },
  {
    permission: 'canVisit',
    message: '訪問ルートの閲覧権限がありません',
  },
);
