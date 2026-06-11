import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { updateVisitScheduleProposalSchema } from '@/lib/validations/visit-schedule-proposal';
import {
  buildVisitScheduleAssignmentWhere,
  buildVisitScheduleProposalAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import {
  computeOptimizedVisitRoute,
  type VisitRoutePlan,
  type VisitRouteTravelMode,
  type VisitRouteWaypoint,
} from '@/server/services/visit-route-engine';
import {
  buildVisitScheduleSnapshot,
  createVisitScheduleContactLog,
} from '@/server/services/visit-schedule-audit';
import {
  evaluateVisitWorkflowGate,
  formatVisitWorkflowGateIssues,
} from '@/server/services/management-plans';
import {
  resolveOperationalTasks,
  upsertOperationalTask,
} from '@/server/services/operational-tasks';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  buildVisitScheduleContactFollowupTask,
  buildVisitScheduleContactTaskKey,
} from '@/server/services/visit-schedule-communication';
import { validateScheduleTimeDatesFitShift } from '@/server/services/visit-schedule-shift';
import { buildProposalRejectAuditChanges } from '@/lib/audit-logs/proposal-rejection';
import { omitProposalRejectReason } from '@/lib/visit-schedule-proposals/response';

type RoutePreviewPoint = {
  schedule_id: string;
  point_kind: 'proposal' | 'schedule';
  patient_name: string;
  address: string;
  lat: number;
  lng: number;
  priority: 'normal' | 'urgent' | 'emergency';
  schedule_status:
    | 'planned'
    | 'in_preparation'
    | 'ready'
    | 'departed'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'postponed'
    | 'rescheduled'
    | 'no_show';
  time_window_start: string | null;
  time_window_end: string | null;
};

type ProposalRoutePreviewRecord = {
  id: string;
  finalized_schedule_id: string | null;
  priority: 'normal' | 'urgent' | 'emergency';
  time_window_start: Date | null;
  time_window_end: Date | null;
  case_: {
    patient: {
      name: string;
      residences: Array<{
        address: string;
        lat: number | null;
        lng: number | null;
      }>;
    };
  };
  site: {
    name: string;
    lat: number | null;
    lng: number | null;
  } | null;
};

type CreationDiagnostics = {
  accepted: Array<{
    pharmacist_id: string;
    pharmacist_name: string;
    site_id: string | null;
    site_name: string | null;
    proposed_date: string;
    travel_mode: VisitRouteTravelMode;
    route_order: number;
    route_distance_score: number;
    travel_summary: string;
    assignment_mode: string;
    care_relationship: string;
    score: number;
    score_breakdown: Record<string, number>;
    time_window_start: string;
    time_window_end: string;
  }>;
  rejected: Array<{
    pharmacist_id: string;
    pharmacist_name: string;
    site_id: string | null;
    site_name: string | null;
    proposed_date: string;
    travel_mode: VisitRouteTravelMode;
    reason_code: string;
    reason_label: string;
    detail: string;
  }>;
};

const ROUTE_ORDER_LOCKED_STATUSES = ['ready', 'departed', 'in_progress', 'completed'] as const;
const CONFIRM_SERIALIZABLE_RETRY_LIMIT = 3;

class VisitProposalConfirmRetryLimitError extends Error {
  constructor() {
    super('visit proposal confirmation transaction retry limit exceeded');
    this.name = 'VisitProposalConfirmRetryLimitError';
  }
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

async function withSerializableConfirmTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < CONFIRM_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === CONFIRM_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new VisitProposalConfirmRetryLimitError();
      }
    }
  }

  throw new VisitProposalConfirmRetryLimitError();
}

async function buildRoutePreview(args: {
  proposal: ProposalRoutePreviewRecord | null;
  relatedProposals: ProposalRoutePreviewRecord[];
  travelMode: VisitRouteTravelMode;
  pharmacistDaySchedules: Array<{
    id: string;
    priority: 'normal' | 'urgent' | 'emergency';
    schedule_status:
      | 'planned'
      | 'in_preparation'
      | 'ready'
      | 'departed'
      | 'in_progress'
      | 'completed'
      | 'cancelled'
      | 'postponed'
      | 'rescheduled'
      | 'no_show';
    time_window_start: Date | null;
    time_window_end: Date | null;
    case_: {
      patient: {
        name: string;
        residences: Array<{
          address: string;
          lat: number | null;
          lng: number | null;
        }>;
      };
    };
  }>;
}) {
  const proposal = args.proposal;
  if (!proposal) {
    return {
      plan: {
        status: 'unavailable',
        note: '候補が見つかりません',
        travelMode: args.travelMode,
        origin: null,
        encodedPath: null,
        orderedScheduleIds: [],
        totalDistanceMeters: null,
        totalDurationSeconds: null,
        stopSummaries: [],
      } satisfies VisitRoutePlan,
      points: [] as RoutePreviewPoint[],
      site: null as { name: string; lat: number; lng: number } | null,
    };
  }

  const waypoints: VisitRouteWaypoint[] = [];
  const points: RoutePreviewPoint[] = [];
  const seenIds = new Set<string>();

  for (const schedule of args.pharmacistDaySchedules) {
    const residence = schedule.case_.patient.residences[0];
    if (!residence?.address || residence.lat == null || residence.lng == null) continue;
    if (seenIds.has(schedule.id)) continue;
    seenIds.add(schedule.id);
    waypoints.push({
      scheduleId: schedule.id,
      patientName: schedule.case_.patient.name,
      address: residence.address,
      lat: residence.lat,
      lng: residence.lng,
      priority: schedule.priority,
    });
    points.push({
      schedule_id: schedule.id,
      point_kind: 'schedule',
      patient_name: schedule.case_.patient.name,
      address: residence.address,
      lat: residence.lat,
      lng: residence.lng,
      priority: schedule.priority,
      schedule_status: schedule.schedule_status,
      time_window_start: schedule.time_window_start?.toISOString() ?? null,
      time_window_end: schedule.time_window_end?.toISOString() ?? null,
    });
  }

  const previewProposals = [proposal, ...args.relatedProposals].filter(
    (item) => !item.finalized_schedule_id,
  );

  for (const previewProposal of previewProposals) {
    const residence = previewProposal.case_?.patient.residences[0];
    if (residence?.address && residence.lat != null && residence.lng != null) {
      const scheduleId = `proposal:${previewProposal.id}`;
      waypoints.push({
        scheduleId,
        patientName: previewProposal.case_.patient.name,
        address: residence.address,
        lat: residence.lat,
        lng: residence.lng,
        priority: previewProposal.priority,
      });
      points.push({
        schedule_id: scheduleId,
        point_kind: 'proposal',
        patient_name: previewProposal.case_.patient.name,
        address: residence.address,
        lat: residence.lat,
        lng: residence.lng,
        priority: previewProposal.priority,
        schedule_status: 'planned',
        time_window_start: previewProposal.time_window_start?.toISOString() ?? null,
        time_window_end: previewProposal.time_window_end?.toISOString() ?? null,
      });
    }
  }

  const site =
    proposal.site?.lat != null && proposal.site.lng != null
      ? {
          name: proposal.site.name,
          lat: proposal.site.lat,
          lng: proposal.site.lng,
        }
      : null;

  let plan: VisitRoutePlan;
  try {
    plan = await computeOptimizedVisitRoute({
      origin: site
        ? {
            lat: site.lat,
            lng: site.lng,
            label: site.name,
          }
        : null,
      travelMode: args.travelMode,
      waypoints,
    });
  } catch (routeError) {
    console.error('[route-preview]', routeError);
    plan = {
      status: 'unavailable',
      note: 'ルートプレビューの計算に失敗しました',
      travelMode: args.travelMode,
      origin: site
        ? {
            lat: site.lat,
            lng: site.lng,
            label: site.name,
          }
        : null,
      encodedPath: null,
      orderedScheduleIds: waypoints.map((waypoint) => waypoint.scheduleId),
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      stopSummaries: waypoints.map((waypoint, index) => ({
        scheduleId: waypoint.scheduleId,
        optimizedOrder: index + 1,
        arrivalOffsetSeconds: null,
        distanceFromPreviousMeters: null,
        durationFromPreviousSeconds: null,
      })),
    };
  }

  return { plan, points, site };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問候補の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問候補IDが不正です');

  const url = new URL(req.url);
  const requestedTravelMode = url.searchParams.get('travel_mode');
  const travelMode: VisitRouteTravelMode =
    requestedTravelMode === 'BICYCLE' ||
    requestedTravelMode === 'WALK' ||
    requestedTravelMode === 'TWO_WHEELER'
      ? requestedTravelMode
      : 'DRIVE';
  const proposalAssignmentWhere = buildVisitScheduleProposalAssignmentWhere(ctx);
  const scheduleAssignmentWhere = buildVisitScheduleAssignmentWhere(ctx);

  const proposal = await prisma.visitScheduleProposal.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(proposalAssignmentWhere ? { AND: [proposalAssignmentWhere] } : {}),
    },
    include: {
      case_: {
        include: {
          patient: {
            include: {
              residences: {
                where: { is_primary: true },
                take: 1,
              },
            },
          },
        },
      },
      site: {
        select: {
          id: true,
          name: true,
          address: true,
          lat: true,
          lng: true,
        },
      },
      vehicle_resource: {
        select: {
          id: true,
          label: true,
          travel_mode: true,
          max_stops: true,
          max_route_duration_minutes: true,
        },
      },
      finalized_schedule: {
        select: {
          id: true,
          scheduled_date: true,
          pharmacist_id: true,
          route_order: true,
          priority: true,
          schedule_status: true,
          time_window_start: true,
          time_window_end: true,
          case_: {
            select: {
              patient: {
                select: {
                  name: true,
                  residences: {
                    where: { is_primary: true },
                    take: 1,
                    select: {
                      address: true,
                      lat: true,
                      lng: true,
                    },
                  },
                },
              },
            },
          },
          site: {
            select: {
              id: true,
              name: true,
              address: true,
              lat: true,
              lng: true,
            },
          },
          vehicle_resource: {
            select: {
              id: true,
              label: true,
              travel_mode: true,
              max_stops: true,
              max_route_duration_minutes: true,
            },
          },
        },
      },
      reschedule_source_schedule: {
        select: {
          id: true,
          scheduled_date: true,
          pharmacist_id: true,
          route_order: true,
          priority: true,
          schedule_status: true,
          time_window_start: true,
          time_window_end: true,
          override_request: {
            select: {
              status: true,
              impact_summary: true,
            },
          },
          case_: {
            select: {
              patient: {
                select: {
                  name: true,
                  residences: {
                    where: { is_primary: true },
                    take: 1,
                    select: {
                      address: true,
                      lat: true,
                      lng: true,
                    },
                  },
                },
              },
            },
          },
          site: {
            select: {
              id: true,
              name: true,
              address: true,
              lat: true,
              lng: true,
            },
          },
          vehicle_resource: {
            select: {
              id: true,
              label: true,
              travel_mode: true,
              max_stops: true,
              max_route_duration_minutes: true,
            },
          },
        },
      },
      contact_logs: {
        orderBy: { called_at: 'desc' },
        take: 20,
      },
    },
  });
  if (!proposal) return notFound('訪問候補が見つかりません');

  const generationWindowStart = new Date(proposal.created_at.getTime() - 5 * 60 * 1000);
  const generationWindowEnd = new Date(proposal.created_at.getTime() + 5 * 60 * 1000);

  const [relatedProposals, pharmacistDaySchedules, creationAuditLog] = await Promise.all([
    prisma.visitScheduleProposal.findMany({
      where: {
        org_id: ctx.orgId,
        case_id: proposal.case_id,
        id: { not: proposal.id },
        created_at: {
          gte: generationWindowStart,
          lte: generationWindowEnd,
        },
        ...(proposal.reschedule_source_schedule_id
          ? { reschedule_source_schedule_id: proposal.reschedule_source_schedule_id }
          : { reschedule_source_schedule_id: null }),
        ...(proposalAssignmentWhere ? { AND: [proposalAssignmentWhere] } : {}),
      },
      include: {
        case_: {
          include: {
            patient: {
              include: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                },
              },
            },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            address: true,
            lat: true,
            lng: true,
          },
        },
        vehicle_resource: {
          select: {
            id: true,
            label: true,
            travel_mode: true,
            max_stops: true,
            max_route_duration_minutes: true,
          },
        },
      },
      orderBy: [{ route_distance_score: 'asc' }, { proposed_date: 'asc' }],
      take: 4,
    }),
    prisma.visitSchedule.findMany({
      where: {
        org_id: ctx.orgId,
        pharmacist_id: proposal.proposed_pharmacist_id,
        scheduled_date: proposal.proposed_date,
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
        ...(scheduleAssignmentWhere ? { AND: [scheduleAssignmentWhere] } : {}),
      },
      select: {
        id: true,
        visit_type: true,
        priority: true,
        schedule_status: true,
        route_order: true,
        scheduled_date: true,
        time_window_start: true,
        time_window_end: true,
        case_: {
          select: {
            patient: {
              select: {
                name: true,
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            address: true,
            lat: true,
            lng: true,
          },
        },
        vehicle_resource: {
          select: {
            id: true,
            label: true,
            travel_mode: true,
            max_stops: true,
            max_route_duration_minutes: true,
          },
        },
      },
      orderBy: [{ route_order: 'asc' }, { time_window_start: 'asc' }],
    }),
    prisma.auditLog.findFirst({
      where: {
        org_id: ctx.orgId,
        target_type: 'VisitScheduleProposal',
        target_id: id,
        action: 'visit_schedule_proposals_created',
      },
      orderBy: { created_at: 'desc' },
      select: {
        changes: true,
      },
    }),
  ]);

  const pharmacists = await prisma.user
    .findMany({
      where: {
        org_id: ctx.orgId,
        id: {
          in: Array.from(
            new Set([
              proposal.proposed_pharmacist_id,
              ...relatedProposals.map((item) => item.proposed_pharmacist_id),
            ]),
          ),
        },
      },
      select: {
        id: true,
        name: true,
        name_kana: true,
      },
    })
    .catch(() => []);

  const pharmacistById = new Map(pharmacists.map((user) => [user.id, user]));
  const routePreview = await buildRoutePreview({
    proposal,
    relatedProposals,
    travelMode,
    pharmacistDaySchedules,
  });
  const creationDiagnostics =
    creationAuditLog?.changes &&
    typeof creationAuditLog.changes === 'object' &&
    !Array.isArray(creationAuditLog.changes) &&
    'diagnostics' in creationAuditLog.changes &&
    creationAuditLog.changes.diagnostics &&
    typeof creationAuditLog.changes.diagnostics === 'object' &&
    !Array.isArray(creationAuditLog.changes.diagnostics)
      ? (creationAuditLog.changes.diagnostics as CreationDiagnostics)
      : null;

  return success({
    data: {
      ...omitProposalRejectReason(proposal),
      proposed_pharmacist: pharmacistById.get(proposal.proposed_pharmacist_id) ?? null,
      related_proposals: relatedProposals.map((item) => ({
        ...omitProposalRejectReason(item),
        proposed_pharmacist: pharmacistById.get(item.proposed_pharmacist_id) ?? null,
      })),
      pharmacist_day_schedules: pharmacistDaySchedules,
      route_preview: routePreview,
      creation_diagnostics: creationDiagnostics,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問候補の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問候補IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateVisitScheduleProposalSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const assignmentWhere = buildVisitScheduleProposalAssignmentWhere(ctx);

  const existing = await prisma.visitScheduleProposal.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    include: {
      case_: {
        select: {
          patient_id: true,
          patient: {
            select: {
              residences: {
                where: { is_primary: true },
                take: 1,
                select: { facility_unit_id: true },
              },
            },
          },
        },
      },
    },
  });
  if (!existing) return notFound('訪問候補が見つかりません');

  const scheduleAssignmentWhere = buildVisitScheduleAssignmentWhere(ctx);
  const buildFinalizedScheduleWhere = (scheduleId: string) => ({
    id: scheduleId,
    org_id: ctx.orgId,
    case_id: existing.case_id,
    ...(scheduleAssignmentWhere ? { AND: [scheduleAssignmentWhere] } : {}),
  });

  if (parsed.data.action === 'approve') {
    if (!['proposed', 'reschedule_pending'].includes(existing.proposal_status)) {
      return validationError('この候補は承認できません');
    }

    if (existing.reschedule_source_schedule_id) {
      const override = await prisma.visitScheduleOverride.findFirst({
        where: {
          org_id: ctx.orgId,
          source_schedule_id: existing.reschedule_source_schedule_id,
        },
        select: {
          approved_at: true,
        },
      });
      if (!override?.approved_at) {
        return validationError('確定済み訪問の変更は管理者承認後に進めてください');
      }
    }

    const proposal = await withOrgContext(ctx.orgId, async (tx) => {
      const updated = await tx.visitScheduleProposal.update({
        where: { id },
        data: {
          proposal_status: 'patient_contact_pending',
          approved_at: new Date(),
          approved_by: ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'visit_schedule_proposal_approved',
          target_type: 'VisitScheduleProposal',
          target_id: id,
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
      });

      return updated;
    });

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedule_proposals_approve', proposal_id: id },
    });

    return success({ data: omitProposalRejectReason(proposal) });
  }

  if (parsed.data.action === 'reject') {
    if (
      !['proposed', 'patient_contact_pending', 'reschedule_pending'].includes(
        existing.proposal_status,
      )
    ) {
      return validationError('この候補は却下できません');
    }
    const rejectReason = parsed.data.reject_reason?.trim();
    const shouldMarkContactDeclined = existing.proposal_status === 'patient_contact_pending';
    const patientContactStatusTo = shouldMarkContactDeclined
      ? 'declined'
      : existing.patient_contact_status;

    const proposal = await withOrgContext(ctx.orgId, async (tx) => {
      const rejectedAt = new Date();
      const updated = await tx.visitScheduleProposal.update({
        where: { id },
        data: {
          proposal_status: 'rejected',
          reject_reason: rejectReason ?? null,
          ...(shouldMarkContactDeclined
            ? {
                patient_contact_status: patientContactStatusTo,
                patient_contacted_at: rejectedAt,
              }
            : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'visit_schedule_proposal_rejected',
          target_type: 'VisitScheduleProposal',
          target_id: id,
          changes: buildProposalRejectAuditChanges({
            rejectReason,
            proposalStatusFrom: existing.proposal_status,
            patientContactStatusFrom: existing.patient_contact_status,
            patientContactStatusTo,
          }),
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
      });

      return updated;
    });

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedule_proposals_reject', proposal_id: id },
    });

    return success({ data: omitProposalRejectReason(proposal) });
  }

  if (parsed.data.action === 'contact_attempt') {
    const data = parsed.data;
    const outcome = data.outcome;

    if (existing.proposal_status !== 'patient_contact_pending') {
      return validationError('この候補には電話結果を記録できません');
    }

    const proposal = await withOrgContext(ctx.orgId, async (tx) => {
      await createVisitScheduleContactLog(tx, {
        orgId: ctx.orgId,
        proposalId: id,
        scheduleId: existing.finalized_schedule_id,
        patientId: existing.case_.patient_id,
        caseId: existing.case_id,
        outcome,
        contactMethod: data.contact_method,
        contactName: data.contact_name,
        contactPhone: data.contact_phone,
        note: data.note,
        callbackDueAt: data.callback_due_at ? new Date(data.callback_due_at) : null,
        calledBy: ctx.userId,
      });

      const updated = await tx.visitScheduleProposal.update({
        where: { id },
        data: {
          proposal_status:
            outcome === 'declined' || outcome === 'change_requested'
              ? 'rejected'
              : 'patient_contact_pending',
          patient_contact_status: outcome,
          patient_contacted_at: new Date(),
        },
      });

      const requiresFollowup = outcome === 'attempted' || outcome === 'unreachable';

      if (requiresFollowup && data.callback_due_at) {
        await upsertOperationalTask(
          tx,
          buildVisitScheduleContactFollowupTask({
            orgId: ctx.orgId,
            proposalId: id,
            caseId: existing.case_id,
            patientId: existing.case_.patient_id,
            assignedTo: existing.proposed_pharmacist_id,
            dueAt: new Date(data.callback_due_at),
            description: data.note ?? '訪問候補の再架電対応を行ってください。',
          }),
        );
      } else {
        await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          dedupeKey: buildVisitScheduleContactTaskKey(id),
          status: 'completed',
        });
      }

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'visit_schedule_contact_logged',
          target_type: 'VisitScheduleProposal',
          target_id: id,
          changes: {
            outcome,
            contact_method: data.contact_method,
            callback_due_at: data.callback_due_at ?? null,
          },
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
      });

      return updated;
    });

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedule_proposals_contact_attempt', proposal_id: id },
    });

    return success({ data: omitProposalRejectReason(proposal) });
  }

  const finalizedScheduleId = existing.finalized_schedule_id;
  if (finalizedScheduleId) {
    const schedule = await withOrgContext(ctx.orgId, async (tx) =>
      tx.visitSchedule.findFirst({
        where: buildFinalizedScheduleWhere(finalizedScheduleId),
      }),
    );
    if (!schedule) {
      return conflict('確定済み訪問を取得できません。再読み込みしてください');
    }
    return success({
      data: {
        proposal: omitProposalRejectReason(existing),
        schedule,
        alreadyFinalized: true,
      },
    });
  }

  if (existing.proposal_status !== 'patient_contact_pending') {
    return validationError('この候補は承認後の電話確認を経てから確定してください');
  }
  if (existing.patient_contact_status !== 'confirmed') {
    return validationError('患者への電話確認結果を「確認済み」にしてから日時確定してください');
  }

  const result = await withSerializableConfirmTransaction(ctx.orgId, async (tx) => {
    const finalizedAt = new Date();

    const currentProposal = await tx.visitScheduleProposal.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
      },
      select: {
        proposal_status: true,
        patient_contact_status: true,
        finalized_schedule_id: true,
      },
    });
    if (!currentProposal) {
      return {
        error: 'state_changed' as const,
      };
    }
    if (currentProposal.finalized_schedule_id) {
      const schedule = await tx.visitSchedule.findFirst({
        where: buildFinalizedScheduleWhere(currentProposal.finalized_schedule_id),
      });
      if (!schedule) {
        return {
          error: 'finalized_schedule_unavailable' as const,
        };
      }
      return {
        proposal: {
          ...existing,
          ...currentProposal,
        },
        schedule,
        alreadyFinalized: true,
      };
    }
    if (
      currentProposal.proposal_status !== 'patient_contact_pending' ||
      currentProposal.patient_contact_status !== 'confirmed'
    ) {
      return {
        error: 'state_changed' as const,
      };
    }

    const gate = await evaluateVisitWorkflowGate(tx, {
      orgId: ctx.orgId,
      patientId: existing.case_.patient_id,
      caseId: existing.case_id,
      asOf: existing.proposed_date,
    });
    if (!gate.ok) {
      return {
        error: 'workflow_gate' as const,
        issues: gate.issues,
      };
    }

    if (existing.reschedule_source_schedule_id) {
      const override = await tx.visitScheduleOverride.findFirst({
        where: {
          source_schedule_id: existing.reschedule_source_schedule_id,
          org_id: ctx.orgId,
        },
        select: {
          approved_at: true,
        },
      });
      if (!override?.approved_at) {
        return {
          error: 'override_not_approved' as const,
        };
      }
    }

    const shift = await tx.pharmacistShift.findFirst({
      where: {
        org_id: ctx.orgId,
        user_id: existing.proposed_pharmacist_id,
        date: existing.proposed_date,
      },
      select: {
        site_id: true,
        available: true,
        available_from: true,
        available_to: true,
      },
    });
    if (!shift) {
      return {
        error: 'shift_unavailable' as const,
        message: '選択した薬剤師のシフトがありません',
      };
    }
    const shiftValidationError = validateScheduleTimeDatesFitShift(
      shift,
      existing.time_window_start,
      existing.time_window_end,
    );
    if (shiftValidationError) {
      return {
        error: 'shift_unavailable' as const,
        message: shiftValidationError,
      };
    }

    if (existing.vehicle_resource_id) {
      const vehicleResource = await tx.visitVehicleResource.findFirst({
        where: {
          org_id: ctx.orgId,
          id: existing.vehicle_resource_id,
          available: true,
        },
        select: {
          site_id: true,
          label: true,
          max_stops: true,
        },
      });
      if (!vehicleResource) {
        return {
          error: 'vehicle_resource_unavailable' as const,
          message: '選択した車両リソースが見つからないか利用できません',
        };
      }
      const targetSiteId = existing.site_id ?? shift.site_id;
      if (targetSiteId && vehicleResource.site_id !== targetSiteId) {
        return {
          error: 'vehicle_resource_unavailable' as const,
          message: '選択した車両リソースは訪問予定の拠点では利用できません',
        };
      }
      if (vehicleResource.max_stops != null) {
        const vehicleScheduleCount = await tx.visitSchedule.count({
          where: {
            org_id: ctx.orgId,
            vehicle_resource_id: existing.vehicle_resource_id,
            scheduled_date: existing.proposed_date,
            schedule_status: {
              notIn: ['cancelled', 'rescheduled'],
            },
          },
        });
        if (vehicleScheduleCount >= vehicleResource.max_stops) {
          return {
            error: 'vehicle_resource_unavailable' as const,
            message: `${vehicleResource.label} で訪問できる件数は最大 ${vehicleResource.max_stops} 件です`,
          };
        }
      }
    }

    const claim = await tx.visitScheduleProposal.updateMany({
      where: {
        id,
        org_id: ctx.orgId,
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        finalized_schedule_id: null,
      },
      data: {
        confirmed_at: finalizedAt,
        confirmed_by: ctx.userId,
      },
    });
    if (claim.count !== 1) {
      const finalizedProposal = await tx.visitScheduleProposal.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
        },
        select: {
          proposal_status: true,
          patient_contact_status: true,
          finalized_schedule_id: true,
        },
      });
      if (finalizedProposal?.finalized_schedule_id) {
        const schedule = await tx.visitSchedule.findFirst({
          where: buildFinalizedScheduleWhere(finalizedProposal.finalized_schedule_id),
        });
        if (!schedule) {
          return {
            error: 'finalized_schedule_unavailable' as const,
          };
        }
        return {
          proposal: {
            ...existing,
            ...finalizedProposal,
          },
          schedule,
          alreadyFinalized: true,
        };
      }
      return {
        error: 'state_changed' as const,
      };
    }

    const lockedRouteSchedules = await tx.visitSchedule.findMany({
      where: {
        org_id: ctx.orgId,
        pharmacist_id: existing.proposed_pharmacist_id,
        scheduled_date: existing.proposed_date,
        route_order: {
          not: null,
        },
        OR: [
          { confirmed_at: { not: null } },
          { schedule_status: { in: [...ROUTE_ORDER_LOCKED_STATUSES] } },
        ],
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
      select: {
        route_order: true,
      },
    });
    const routeOrderFloor = lockedRouteSchedules.reduce(
      (maxOrder, schedule) => Math.max(maxOrder, schedule.route_order ?? 0),
      0,
    );
    const finalizedRouteOrder = Math.max(existing.route_order ?? 1, routeOrderFloor + 1);

    await tx.visitSchedule.updateMany({
      where: {
        org_id: ctx.orgId,
        pharmacist_id: existing.proposed_pharmacist_id,
        scheduled_date: existing.proposed_date,
        route_order: {
          gte: finalizedRouteOrder,
        },
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
      data: {
        route_order: {
          increment: 1,
        },
      },
    });

    const schedule = await tx.visitSchedule.create({
      data: {
        org_id: ctx.orgId,
        case_id: existing.case_id,
        cycle_id: existing.cycle_id ?? null,
        site_id: existing.site_id ?? null,
        facility_unit_id: existing.case_.patient?.residences[0]?.facility_unit_id ?? null,
        visit_type: existing.visit_type,
        priority: existing.priority,
        schedule_status: 'planned',
        scheduled_date: existing.proposed_date,
        time_window_start: existing.time_window_start,
        time_window_end: existing.time_window_end,
        pharmacist_id: existing.proposed_pharmacist_id,
        assignment_mode: existing.assignment_mode,
        escalation_reason: existing.escalation_reason,
        route_order: finalizedRouteOrder,
        vehicle_resource_id: existing.vehicle_resource_id ?? null,
        recurrence_rule: existing.suggested_recurrence_rule ?? null,
        medication_end_date: existing.medication_end_date,
        visit_deadline_date: existing.visit_deadline_date,
        confirmed_at: finalizedAt,
        confirmed_by: ctx.userId,
      },
    });

    await tx.visitScheduleContactLog.updateMany({
      where: {
        org_id: ctx.orgId,
        proposal_id: id,
        schedule_id: null,
      },
      data: {
        schedule_id: schedule.id,
      },
    });

    await tx.visitScheduleProposal.updateMany({
      where: {
        org_id: ctx.orgId,
        case_id: existing.case_id,
        id: { not: id },
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        ...(existing.reschedule_source_schedule_id
          ? { reschedule_source_schedule_id: existing.reschedule_source_schedule_id }
          : { reschedule_source_schedule_id: null }),
      },
      data: {
        proposal_status: 'superseded',
      },
    });

    const proposal = await tx.visitScheduleProposal.update({
      where: { id },
      data: {
        proposal_status: 'confirmed',
        patient_contact_status: 'confirmed',
        patient_contacted_at: finalizedAt,
        confirmed_at: finalizedAt,
        confirmed_by: ctx.userId,
        finalized_schedule_id: schedule.id,
        route_order: finalizedRouteOrder,
      },
    });

    if (existing.reschedule_source_schedule_id) {
      await tx.visitScheduleOverride.update({
        where: {
          source_schedule_id: existing.reschedule_source_schedule_id,
        },
        data: {
          status: 'completed',
          replacement_schedule_id: schedule.id,
          after_snapshot: buildVisitScheduleSnapshot(schedule),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'visit_schedule_confirmed',
        target_type: 'VisitSchedule',
        target_id: schedule.id,
        changes: {
          proposal_id: id,
          reschedule_source_schedule_id: existing.reschedule_source_schedule_id,
          vehicle_resource_id: existing.vehicle_resource_id ?? null,
        },
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });

    await resolveOperationalTasks(tx, {
      orgId: ctx.orgId,
      dedupeKey: buildVisitScheduleContactTaskKey(id),
      status: 'completed',
    });

    return { proposal, schedule, alreadyFinalized: false };
  }).catch((cause: unknown) => {
    if (cause instanceof VisitProposalConfirmRetryLimitError) {
      return {
        error: 'serialization_conflict' as const,
      };
    }
    throw cause;
  });

  if ('error' in result) {
    if (result.error === 'workflow_gate') {
      return validationError(formatVisitWorkflowGateIssues(result.issues));
    }
    if (result.error === 'override_not_approved') {
      return validationError('確定済み訪問の変更は承認後に新候補を確定してください');
    }
    if (result.error === 'state_changed') {
      return conflict('この候補はすでに確定または変更されています。再読み込みしてください');
    }
    if (result.error === 'finalized_schedule_unavailable') {
      return conflict('確定済み訪問を取得できません。再読み込みしてください');
    }
    if (result.error === 'serialization_conflict') {
      return conflict('訪問候補の確定が同時に更新されました。再読み込みしてください');
    }
    if (result.error === 'shift_unavailable') {
      return validationError(result.message);
    }
    if (result.error === 'vehicle_resource_unavailable') {
      return validationError(result.message);
    }
  }

  if (!result.alreadyFinalized) {
    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedule_proposals_confirm', proposal_id: id },
    });
  }

  return success({
    data: {
      ...result,
      proposal: omitProposalRejectReason(result.proposal),
    },
  });
}
