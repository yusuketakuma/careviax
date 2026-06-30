import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { formatUtcDateKey } from '@/lib/date-key';
import { buildOperatingCalendarFromDbRows } from '@/lib/calendar/operating-day-adapter';
import { resolveOperatingState } from '@/lib/calendar/operating-day';
import { logger } from '@/lib/utils/logger';
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
  buildVisitScheduleReproposalNeededTask,
} from '@/server/services/visit-schedule-communication';
import { validateScheduleTimeDatesFitShift } from '@/server/services/visit-schedule-shift';
import { validateVisitScheduleBlockingBillingRequirements } from '@/server/services/visit-schedule-billing-guard';
import {
  findVisitScheduleTimeConflict,
  getVisitScheduleTimeConflictMessage,
  type VisitScheduleTimeConflictKind,
} from '@/server/services/visit-schedule-service';
import { createRoadTravelEstimator } from '@/server/services/road-routing';
import {
  estimateVehicleRouteDurationWithCandidate,
  type VehicleRouteDurationPoint,
} from '@/server/services/visit-schedule-planner';
import { buildProposalRejectAuditChanges } from '@/lib/audit-logs/proposal-rejection';
import {
  omitProposalRejectReason,
  redactProposalContactLogs,
  redactProposalPatientFields,
} from '@/lib/visit-schedule-proposals/response';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES as OPEN_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';

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
  org_id: string;
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

function readOperatingDayOverrideReason(changes: unknown): string | null {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null;
  if (!('operating_day_override_reason' in changes)) return null;
  const value = changes.operating_day_override_reason;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function operatingDayConfirmBlockedMessage(dateKey: string, reason: 'holiday' | 'regular_closed') {
  const label = reason === 'regular_closed' ? '定休日' : '休業日';
  return `${dateKey}: 訪問拠点が${label}のため訪問候補を確定できません。休業日上書き理由を入力して候補を再生成してください`;
}

class VisitProposalConfirmRetryLimitError extends Error {
  constructor() {
    super('visit proposal confirmation transaction retry limit exceeded');
    this.name = 'VisitProposalConfirmRetryLimitError';
  }
}

class VisitProposalOverrideStateChangedError extends Error {
  constructor() {
    super('visit proposal reschedule override state changed');
    this.name = 'VisitProposalOverrideStateChangedError';
  }
}

class VisitProposalConfirmTimeConflictError extends Error {
  constructor(readonly conflictKind: VisitScheduleTimeConflictKind) {
    super('visit proposal confirmation time conflict');
    this.name = 'VisitProposalConfirmTimeConflictError';
  }
}

class VisitProposalConfirmDuplicateActiveScheduleError extends Error {
  constructor() {
    super('visit proposal confirmation duplicate active schedule');
    this.name = 'VisitProposalConfirmDuplicateActiveScheduleError';
  }
}

type RescheduleOverrideReadiness = {
  approved_at: Date | null;
  status: string;
  source_schedule?: {
    schedule_status: string;
  } | null;
} | null;

function isApprovedPendingRescheduleOverride(override: RescheduleOverrideReadiness) {
  return override?.approved_at != null && override.status === 'pending';
}

function isApprovedRescheduleSourceStillHeld(override: RescheduleOverrideReadiness) {
  return (
    isApprovedPendingRescheduleOverride(override) &&
    override?.source_schedule?.schedule_status === 'rescheduled'
  );
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

function appendRoutePreviewNote(note: string | null, next: string) {
  return note ? `${note} / ${next}` : next;
}

function formatRoutePreviewIssueNote(label: string, patientNames: string[]) {
  const counts = new Map<string, number>();
  for (const patientName of patientNames) {
    counts.set(patientName, (counts.get(patientName) ?? 0) + 1);
  }

  const names = [...counts.entries()].map(([patientName, count]) =>
    count > 1 ? `${patientName}（${count}件）` : patientName,
  );
  return `${label} ${patientNames.length}件: ${names.join('、')}`;
}

function isUniqueConstraintError(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002';
}

function nullableContactAttemptField(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

type ContactAttemptFingerprintInput = {
  outcome: string;
  contact_method: string;
  contact_name?: string;
  contact_phone?: string;
  note?: string;
  callback_due_at?: string;
};

function buildContactAttemptRequestFingerprint({
  proposalId,
  calledBy,
  data,
}: {
  proposalId: string;
  calledBy: string;
  data: ContactAttemptFingerprintInput;
}) {
  const fingerprintInput = {
    action: 'contact_attempt',
    proposal_id: proposalId,
    called_by: calledBy,
    outcome: data.outcome,
    contact_method: data.contact_method,
    contact_name: nullableContactAttemptField(data.contact_name),
    contact_phone: nullableContactAttemptField(data.contact_phone),
    note: nullableContactAttemptField(data.note),
    callback_due_at: data.callback_due_at ?? null,
  };
  return createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
}

async function findContactAttemptLogByIdempotency(orgId: string, idempotencyKey: string) {
  return prisma.visitScheduleContactLog.findFirst({
    where: {
      org_id: orgId,
      idempotency_key: idempotencyKey,
    },
    select: {
      proposal_id: true,
      request_fingerprint: true,
      called_by: true,
    },
  });
}

function isMatchingContactAttemptReplay({
  log,
  proposalId,
  requestFingerprint,
  calledBy,
}: {
  log: { proposal_id: string; request_fingerprint: string | null; called_by: string };
  proposalId: string;
  requestFingerprint: string;
  calledBy: string;
}) {
  return (
    log.proposal_id === proposalId &&
    log.request_fingerprint === requestFingerprint &&
    log.called_by === calledBy
  );
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
  const missingGeocodePatientNames: string[] = [];
  const missingAddressPatientNames: string[] = [];

  for (const schedule of args.pharmacistDaySchedules) {
    const residence = schedule.case_.patient.residences[0];
    if (!residence?.address?.trim()) {
      missingAddressPatientNames.push(schedule.case_.patient.name);
      continue;
    }
    if (residence.lat == null || residence.lng == null) {
      missingGeocodePatientNames.push(schedule.case_.patient.name);
      continue;
    }
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
    const patientName = previewProposal.case_?.patient.name ?? '患者名未設定';
    if (!residence?.address?.trim()) {
      missingAddressPatientNames.push(patientName);
    } else if (residence.lat == null || residence.lng == null) {
      missingGeocodePatientNames.push(patientName);
    } else {
      const scheduleId = `proposal:${previewProposal.id}`;
      waypoints.push({
        scheduleId,
        patientName,
        address: residence.address,
        lat: residence.lat,
        lng: residence.lng,
        priority: previewProposal.priority,
      });
      points.push({
        schedule_id: scheduleId,
        point_kind: 'proposal',
        patient_name: patientName,
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
    logger.error(
      {
        event: 'visit_route.preview_failed',
        orgId: proposal.org_id,
        entityType: 'visit_schedule_proposal',
        entityId: proposal.id,
        code: 'ROUTE_PREVIEW_FAILED',
      },
      routeError,
    );
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

  if (missingAddressPatientNames.length > 0 || missingGeocodePatientNames.length > 0) {
    const notes: string[] = [];
    if (missingAddressPatientNames.length > 0) {
      notes.push(formatRoutePreviewIssueNote('住所未設定', missingAddressPatientNames));
    }
    if (missingGeocodePatientNames.length > 0) {
      notes.push(formatRoutePreviewIssueNote('座標未設定', missingGeocodePatientNames));
    }

    plan = {
      ...plan,
      note: notes.reduce((note, next) => appendRoutePreviewNote(note, next), plan.note),
    };
  }

  return { plan, points, site };
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
        select: {
          patient: {
            select: {
              id: true,
              name: true,
              residences: {
                where: { is_primary: true },
                take: 1,
                select: {
                  address: true,
                  building_id: true,
                  unit_name: true,
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
        select: {
          id: true,
          outcome: true,
          contact_method: true,
          callback_due_at: true,
          called_at: true,
          note: true,
        },
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
          select: {
            patient: {
              select: {
                id: true,
                name: true,
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    building_id: true,
                    unit_name: true,
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
      ...redactProposalPatientFields(redactProposalContactLogs(omitProposalRejectReason(proposal))),
      proposed_pharmacist: pharmacistById.get(proposal.proposed_pharmacist_id) ?? null,
      related_proposals: relatedProposals.map((item) => ({
        ...redactProposalPatientFields(omitProposalRejectReason(item)),
        proposed_pharmacist: pharmacistById.get(item.proposed_pharmacist_id) ?? null,
      })),
      pharmacist_day_schedules: pharmacistDaySchedules,
      route_preview: routePreview,
      creation_diagnostics: creationDiagnostics,
    },
  });
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, context));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

async function authenticatedPATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const findProposalForPatch = () =>
    prisma.visitScheduleProposal.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
        ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
      },
      include: {
        case_: {
          select: {
            patient_id: true,
            required_visit_support: true,
            patient: {
              select: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    facility_unit_id: true,
                    address: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
      },
    });

  const existing = await findProposalForPatch();
  if (!existing) return notFound('訪問候補が見つかりません');

  const scheduleAssignmentWhere = buildVisitScheduleAssignmentWhere(ctx);
  const buildFinalizedScheduleWhere = (scheduleId: string, caseId = existing.case_id) => ({
    id: scheduleId,
    org_id: ctx.orgId,
    case_id: caseId,
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
          status: true,
          source_schedule: {
            select: {
              schedule_status: true,
            },
          },
        },
      });
      if (!isApprovedPendingRescheduleOverride(override)) {
        return validationError('確定済み訪問の変更は管理者承認後に進めてください');
      }
      if (!isApprovedRescheduleSourceStillHeld(override)) {
        return conflict('元の訪問予定が変更済みです。再読み込みしてください');
      }
    }

    const approvalResult = await withOrgContext(ctx.orgId, async (tx) => {
      const approvedAt = new Date();
      if (existing.reschedule_source_schedule_id) {
        const override = await tx.visitScheduleOverride.findFirst({
          where: {
            org_id: ctx.orgId,
            source_schedule_id: existing.reschedule_source_schedule_id,
          },
          select: {
            approved_at: true,
            status: true,
            source_schedule: {
              select: {
                schedule_status: true,
              },
            },
          },
        });
        if (!isApprovedPendingRescheduleOverride(override)) {
          return { kind: 'override_not_approved' as const };
        }
        if (!isApprovedRescheduleSourceStillHeld(override)) {
          return { kind: 'source_schedule_state_changed' as const };
        }
      }

      const claim = await tx.visitScheduleProposal.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          proposal_status: { in: ['proposed', 'reschedule_pending'] },
          finalized_schedule_id: null,
          ...(existing.reschedule_source_schedule_id
            ? {
                reschedule_source_schedule_id: existing.reschedule_source_schedule_id,
                reschedule_source_schedule: {
                  is: {
                    schedule_status: 'rescheduled',
                  },
                },
              }
            : {}),
        },
        data: {
          proposal_status: 'patient_contact_pending',
          approved_at: approvedAt,
          approved_by: ctx.userId,
        },
      });
      if (claim.count !== 1) return { kind: 'conflict' as const };

      await createAuditLogEntry(tx, ctx, {
        action: 'visit_schedule_proposal_approved',
        targetType: 'VisitScheduleProposal',
        targetId: id,
      });

      return {
        kind: 'success' as const,
        proposal: {
          ...existing,
          proposal_status: 'patient_contact_pending' as const,
          approved_at: approvedAt,
          approved_by: ctx.userId,
        },
      };
    });

    if (approvalResult.kind === 'conflict') {
      return conflict('この候補はすでに確定または変更されています。再読み込みしてください');
    }
    if (approvalResult.kind === 'override_not_approved') {
      return validationError('確定済み訪問の変更は管理者承認後に進めてください');
    }
    if (approvalResult.kind === 'source_schedule_state_changed') {
      return conflict('元の訪問予定が変更済みです。再読み込みしてください');
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedule_proposals_approve', proposal_id: id },
    });

    return success({ data: omitProposalRejectReason(approvalResult.proposal) });
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

    const rejectionResult = await withOrgContext(ctx.orgId, async (tx) => {
      const rejectedAt = new Date();
      const claim = await tx.visitScheduleProposal.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          proposal_status: {
            in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
          },
          finalized_schedule_id: null,
        },
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
      if (claim.count !== 1) return { kind: 'conflict' as const };

      await createAuditLogEntry(tx, ctx, {
        action: 'visit_schedule_proposal_rejected',
        targetType: 'VisitScheduleProposal',
        targetId: id,
        changes: buildProposalRejectAuditChanges({
          rejectReason,
          proposalStatusFrom: existing.proposal_status,
          patientContactStatusFrom: existing.patient_contact_status,
          patientContactStatusTo,
        }),
      });

      if (shouldMarkContactDeclined) {
        await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          dedupeKey: buildVisitScheduleContactTaskKey(id),
          status: 'completed',
        });
      }

      return {
        kind: 'success' as const,
        proposal: {
          ...existing,
          proposal_status: 'rejected' as const,
          reject_reason: rejectReason ?? null,
          ...(shouldMarkContactDeclined
            ? {
                patient_contact_status: patientContactStatusTo,
                patient_contacted_at: rejectedAt,
              }
            : {}),
        },
      };
    });

    if (rejectionResult.kind === 'conflict') {
      return conflict('この候補はすでに確定または変更されています。再読み込みしてください');
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedule_proposals_reject', proposal_id: id },
    });

    return success({ data: omitProposalRejectReason(rejectionResult.proposal) });
  }

  if (parsed.data.action === 'contact_attempt') {
    const data = parsed.data;
    const outcome = data.outcome;
    const requestFingerprint = buildContactAttemptRequestFingerprint({
      proposalId: id,
      calledBy: ctx.userId,
      data,
    });

    const replayedLog = await findContactAttemptLogByIdempotency(ctx.orgId, data.idempotency_key);
    if (replayedLog) {
      if (
        !isMatchingContactAttemptReplay({
          log: replayedLog,
          proposalId: id,
          requestFingerprint,
          calledBy: ctx.userId,
        })
      ) {
        return conflict('idempotency_key が別の連絡結果記録で使用されています');
      }

      return success({ data: omitProposalRejectReason(existing) });
    }

    if (existing.proposal_status !== 'patient_contact_pending') {
      return validationError('この候補には電話結果を記録できません');
    }

    const contactResult = await withOrgContext(ctx.orgId, async (tx) => {
      const contactedAt = new Date();
      const current = await tx.visitScheduleProposal.findFirst({
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
      if (
        !current ||
        current.proposal_status !== 'patient_contact_pending' ||
        current.finalized_schedule_id
      ) {
        return { kind: 'conflict' as const };
      }
      if (current.patient_contact_status === 'confirmed' && outcome !== 'confirmed') {
        return { kind: 'confirmed_downgrade' as const };
      }

      const nextProposalStatus =
        outcome === 'declined'
          ? 'rejected'
          : outcome === 'change_requested'
            ? 'reschedule_pending'
            : 'patient_contact_pending';
      const claim = await tx.visitScheduleProposal.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          proposal_status: 'patient_contact_pending',
          finalized_schedule_id: null,
        },
        data: {
          proposal_status: nextProposalStatus,
          patient_contact_status: outcome,
          patient_contacted_at: contactedAt,
        },
      });
      if (claim.count !== 1) return { kind: 'conflict' as const };

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
        idempotencyKey: data.idempotency_key,
        requestFingerprint,
        calledBy: ctx.userId,
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
            description: '再架電が必要です。詳細は確定フローで確認してください。',
          }),
        );
      } else if (outcome === 'change_requested') {
        await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          dedupeKey: buildVisitScheduleContactTaskKey(id),
          status: 'completed',
        });
        await upsertOperationalTask(
          tx,
          buildVisitScheduleReproposalNeededTask({
            orgId: ctx.orgId,
            proposalId: id,
            caseId: existing.case_id,
            patientId: existing.case_.patient_id,
            assignedTo: existing.proposed_pharmacist_id,
            dueAt: contactedAt,
            description: '患者の変更希望に合わせて候補を再生成してください。',
          }),
        );
      } else {
        await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          dedupeKey: buildVisitScheduleContactTaskKey(id),
          status: 'completed',
        });
      }

      await createAuditLogEntry(tx, ctx, {
        action: 'visit_schedule_contact_logged',
        targetType: 'VisitScheduleProposal',
        targetId: id,
        changes: {
          outcome,
          contact_method: data.contact_method,
          callback_due_at: data.callback_due_at ?? null,
        },
      });

      return {
        kind: 'success' as const,
        proposal: {
          ...existing,
          proposal_status: nextProposalStatus,
          patient_contact_status: outcome,
          patient_contacted_at: contactedAt,
        },
      };
    }).catch(async (error: unknown) => {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrentLog = await findContactAttemptLogByIdempotency(
        ctx.orgId,
        data.idempotency_key,
      );
      if (
        concurrentLog &&
        isMatchingContactAttemptReplay({
          log: concurrentLog,
          proposalId: id,
          requestFingerprint,
          calledBy: ctx.userId,
        })
      ) {
        const replayProposal = await findProposalForPatch();
        if (!replayProposal) return { kind: 'not_found' as const };
        return { kind: 'replay' as const, proposal: replayProposal };
      }
      return { kind: 'idempotency_conflict' as const };
    });

    if (contactResult.kind === 'conflict') {
      return conflict('この候補はすでに確定または変更されています。再読み込みしてください');
    }
    if (contactResult.kind === 'confirmed_downgrade') {
      return conflict('患者確認済みの連絡結果は未接続へ戻せません。再読み込みしてください');
    }
    if (contactResult.kind === 'idempotency_conflict') {
      return conflict('idempotency_key が別の連絡結果記録で使用されています');
    }
    if (contactResult.kind === 'not_found') {
      return notFound('訪問候補が見つかりません');
    }
    if (contactResult.kind === 'replay') {
      return success({ data: omitProposalRejectReason(contactResult.proposal) });
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedule_proposals_contact_attempt', proposal_id: id },
    });

    return success({ data: omitProposalRejectReason(contactResult.proposal) });
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
      include: {
        case_: {
          select: {
            patient_id: true,
            required_visit_support: true,
            patient: {
              select: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    facility_unit_id: true,
                    address: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!currentProposal) {
      return {
        error: 'state_changed' as const,
      };
    }
    if (currentProposal.finalized_schedule_id) {
      const schedule = await tx.visitSchedule.findFirst({
        where: buildFinalizedScheduleWhere(
          currentProposal.finalized_schedule_id,
          currentProposal.case_id,
        ),
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
      patientId: currentProposal.case_.patient_id,
      caseId: currentProposal.case_id,
      asOf: currentProposal.proposed_date,
    });
    if (!gate.ok) {
      return {
        error: 'workflow_gate' as const,
        issues: gate.issues,
      };
    }

    if (currentProposal.reschedule_source_schedule_id) {
      const override = await tx.visitScheduleOverride.findFirst({
        where: {
          source_schedule_id: currentProposal.reschedule_source_schedule_id,
          org_id: ctx.orgId,
        },
        select: {
          approved_at: true,
          status: true,
          source_schedule: {
            select: {
              schedule_status: true,
            },
          },
        },
      });
      if (!isApprovedPendingRescheduleOverride(override)) {
        return {
          error: 'override_not_approved' as const,
        };
      }
      if (!isApprovedRescheduleSourceStillHeld(override)) {
        return {
          error: 'source_schedule_state_changed' as const,
        };
      }
    }

    const shift = await tx.pharmacistShift.findFirst({
      where: {
        org_id: ctx.orgId,
        user_id: currentProposal.proposed_pharmacist_id,
        date: currentProposal.proposed_date,
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
      currentProposal.time_window_start,
      currentProposal.time_window_end,
    );
    if (shiftValidationError) {
      return {
        error: 'shift_unavailable' as const,
        message: shiftValidationError,
      };
    }

    if (currentProposal.vehicle_resource_id) {
      const vehicleResource = await tx.visitVehicleResource.findFirst({
        where: {
          org_id: ctx.orgId,
          id: currentProposal.vehicle_resource_id,
          available: true,
        },
        select: {
          site_id: true,
          label: true,
          travel_mode: true,
          max_stops: true,
          max_route_duration_minutes: true,
        },
      });
      if (!vehicleResource) {
        return {
          error: 'vehicle_resource_unavailable' as const,
          message: '選択した車両リソースが見つからないか利用できません',
        };
      }
      const targetSiteId = currentProposal.site_id ?? shift.site_id;
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
            vehicle_resource_id: currentProposal.vehicle_resource_id,
            scheduled_date: currentProposal.proposed_date,
            ...(currentProposal.reschedule_source_schedule_id
              ? { id: { not: currentProposal.reschedule_source_schedule_id } }
              : {}),
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
      if (vehicleResource.max_route_duration_minutes != null) {
        const site = await tx.pharmacySite.findFirst({
          where: {
            org_id: ctx.orgId,
            id: targetSiteId ?? vehicleResource.site_id,
          },
          select: {
            address: true,
            lat: true,
            lng: true,
          },
        });
        const existingVehicleSchedules = await tx.visitSchedule.findMany({
          where: {
            org_id: ctx.orgId,
            vehicle_resource_id: currentProposal.vehicle_resource_id,
            scheduled_date: currentProposal.proposed_date,
            ...(currentProposal.reschedule_source_schedule_id
              ? { id: { not: currentProposal.reschedule_source_schedule_id } }
              : {}),
            schedule_status: {
              notIn: ['cancelled', 'rescheduled'],
            },
          },
          select: {
            route_order: true,
            time_window_start: true,
            case_: {
              select: {
                patient: {
                  select: {
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
          },
        });
        const existingPoints: VehicleRouteDurationPoint[] = existingVehicleSchedules.map(
          (schedule) => ({
            routeOrder: schedule.route_order ?? null,
            lat: schedule.case_.patient.residences[0]?.lat ?? null,
            lng: schedule.case_.patient.residences[0]?.lng ?? null,
            address: schedule.case_.patient.residences[0]?.address ?? null,
            startsAt: schedule.time_window_start ?? null,
          }),
        );
        const proposalResidence = currentProposal.case_.patient.residences[0] ?? null;
        const routeDuration = await estimateVehicleRouteDurationWithCandidate(
          site
            ? {
                routeOrder: 0,
                lat: site.lat,
                lng: site.lng,
                address: site.address,
                startsAt: null,
              }
            : null,
          existingPoints,
          {
            routeOrder: currentProposal.route_order ?? null,
            lat: proposalResidence?.lat ?? null,
            lng: proposalResidence?.lng ?? null,
            address: proposalResidence?.address ?? null,
            startsAt: currentProposal.time_window_start ?? null,
          },
          createRoadTravelEstimator(vehicleResource.travel_mode),
          vehicleResource.travel_mode,
        );
        if (routeDuration.durationMinutes == null) {
          return {
            error: 'vehicle_resource_unavailable' as const,
            message: `${vehicleResource.label} の稼働上限 ${vehicleResource.max_route_duration_minutes}分を検証できません。訪問先と拠点の住所座標を整備してから確定してください`,
          };
        }
        if (routeDuration.durationMinutes > vehicleResource.max_route_duration_minutes) {
          return {
            error: 'vehicle_resource_unavailable' as const,
            message: `${vehicleResource.label} の候補確定後の推定稼働時間 ${routeDuration.durationMinutes.toFixed(1)}分 が上限 ${vehicleResource.max_route_duration_minutes}分を超えます`,
          };
        }
      }
    }

    const operatingSiteId = currentProposal.site_id ?? shift.site_id;
    const scheduledDateKey = formatUtcDateKey(currentProposal.proposed_date);
    let operatingDayOverrideAudit: {
      siteId: string;
      reason: 'holiday' | 'regular_closed';
      overrideReason: string;
    } | null = null;
    if (operatingSiteId) {
      const [operatingWeeklyRows, operatingHolidayRows, creationAuditLog] = await Promise.all([
        tx.pharmacyOperatingHours.findMany({
          where: {
            org_id: ctx.orgId,
            site_id: operatingSiteId,
          },
          select: {
            id: true,
            site_id: true,
            weekday: true,
            is_open: true,
            open_time: true,
            close_time: true,
            note: true,
          },
        }),
        tx.businessHoliday.findMany({
          where: {
            org_id: ctx.orgId,
            date: currentProposal.proposed_date,
            OR: [{ site_id: operatingSiteId }, { site_id: null }],
          },
          select: {
            id: true,
            site_id: true,
            date: true,
            name: true,
            holiday_type: true,
            is_closed: true,
            open_time: true,
            close_time: true,
          },
        }),
        tx.auditLog.findFirst({
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
      const operatingState = resolveOperatingState(
        buildOperatingCalendarFromDbRows(
          operatingSiteId,
          operatingWeeklyRows,
          operatingHolidayRows,
        ),
        scheduledDateKey,
      );
      if (!operatingState.open) {
        const overrideReason = readOperatingDayOverrideReason(creationAuditLog?.changes);
        if (!overrideReason) {
          return {
            error: 'operating_day_closed' as const,
            message: operatingDayConfirmBlockedMessage(scheduledDateKey, operatingState.reason),
          };
        }
        operatingDayOverrideAudit = {
          siteId: operatingSiteId,
          reason: operatingState.reason,
          overrideReason,
        };
      }
    }

    const billingValidation = await validateVisitScheduleBlockingBillingRequirements({
      db: tx,
      orgId: ctx.orgId,
      caseId: currentProposal.case_id,
      patientId: currentProposal.case_.patient_id,
      pharmacistId: currentProposal.proposed_pharmacist_id,
      visitType: currentProposal.visit_type,
      proposedDate: currentProposal.proposed_date,
      requiredVisitSupport: currentProposal.case_.required_visit_support,
      excludeProposalId: id,
      excludeScheduleId: currentProposal.reschedule_source_schedule_id,
      excludeSupersededProposalScope: {
        caseId: currentProposal.case_id,
        rescheduleSourceScheduleId: currentProposal.reschedule_source_schedule_id,
      },
      workflowPrevalidated: true,
    });
    if (billingValidation.blockingMessages.length > 0) {
      return {
        error: 'billing_cap_exceeded' as const,
        message: billingValidation.blockingMessages.join(' / '),
      };
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

    const confirmedProposal = await tx.visitScheduleProposal.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
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
    if (
      !confirmedProposal ||
      confirmedProposal.proposal_status !== 'patient_contact_pending' ||
      confirmedProposal.patient_contact_status !== 'confirmed' ||
      confirmedProposal.finalized_schedule_id
    ) {
      return {
        error: 'state_changed' as const,
      };
    }

    const timeConflict = await findVisitScheduleTimeConflict(tx, {
      orgId: ctx.orgId,
      scheduledDate: confirmedProposal.proposed_date,
      pharmacistId: confirmedProposal.proposed_pharmacist_id,
      timeWindowStart: confirmedProposal.time_window_start,
      timeWindowEnd: confirmedProposal.time_window_end,
      vehicleResourceId: confirmedProposal.vehicle_resource_id,
      excludeScheduleId: confirmedProposal.reschedule_source_schedule_id ?? undefined,
    });
    if (timeConflict) {
      throw new VisitProposalConfirmTimeConflictError(timeConflict.kind);
    }

    const duplicateActiveSchedule = await tx.visitSchedule.findFirst({
      where: {
        org_id: ctx.orgId,
        case_id: confirmedProposal.case_id,
        visit_type: confirmedProposal.visit_type,
        scheduled_date: confirmedProposal.proposed_date,
        ...(confirmedProposal.reschedule_source_schedule_id
          ? { id: { not: confirmedProposal.reschedule_source_schedule_id } }
          : {}),
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    if (duplicateActiveSchedule) {
      throw new VisitProposalConfirmDuplicateActiveScheduleError();
    }

    const lockedRouteSchedules = await tx.visitSchedule.findMany({
      where: {
        org_id: ctx.orgId,
        pharmacist_id: confirmedProposal.proposed_pharmacist_id,
        scheduled_date: confirmedProposal.proposed_date,
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

    const supersededSiblingWhere = confirmedProposal.reschedule_source_schedule_id
      ? { reschedule_source_schedule_id: confirmedProposal.reschedule_source_schedule_id }
      : { reschedule_source_schedule_id: null };
    const remainingOpenProposals = await tx.visitScheduleProposal.findMany({
      where: {
        id: {
          not: id,
        },
        org_id: ctx.orgId,
        proposed_pharmacist_id: confirmedProposal.proposed_pharmacist_id,
        proposed_date: confirmedProposal.proposed_date,
        finalized_schedule_id: null,
        proposal_status: {
          in: OPEN_PROPOSAL_STATUSES,
        },
        route_order: {
          not: null,
        },
        NOT: {
          case_id: confirmedProposal.case_id,
          ...supersededSiblingWhere,
        },
      },
      select: {
        route_order: true,
      },
    });
    const proposalRouteOrderFloor = remainingOpenProposals.reduce(
      (maxOrder, proposal) => Math.max(maxOrder, proposal.route_order ?? 0),
      0,
    );
    const finalizedRouteOrder = Math.max(
      confirmedProposal.route_order ?? 1,
      routeOrderFloor + 1,
      proposalRouteOrderFloor + 1,
    );

    await tx.visitSchedule.updateMany({
      where: {
        org_id: ctx.orgId,
        pharmacist_id: confirmedProposal.proposed_pharmacist_id,
        scheduled_date: confirmedProposal.proposed_date,
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
        case_id: confirmedProposal.case_id,
        cycle_id: confirmedProposal.cycle_id ?? null,
        site_id: confirmedProposal.site_id ?? null,
        facility_unit_id: confirmedProposal.case_.patient?.residences[0]?.facility_unit_id ?? null,
        visit_type: confirmedProposal.visit_type,
        priority: confirmedProposal.priority,
        schedule_status: 'planned',
        scheduled_date: confirmedProposal.proposed_date,
        time_window_start: confirmedProposal.time_window_start,
        time_window_end: confirmedProposal.time_window_end,
        pharmacist_id: confirmedProposal.proposed_pharmacist_id,
        assignment_mode: confirmedProposal.assignment_mode,
        escalation_reason: confirmedProposal.escalation_reason,
        route_order: finalizedRouteOrder,
        vehicle_resource_id: confirmedProposal.vehicle_resource_id ?? null,
        recurrence_rule: confirmedProposal.suggested_recurrence_rule ?? null,
        medication_end_date: confirmedProposal.medication_end_date,
        visit_deadline_date: confirmedProposal.visit_deadline_date,
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
        case_id: confirmedProposal.case_id,
        id: { not: id },
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        ...(confirmedProposal.reschedule_source_schedule_id
          ? { reschedule_source_schedule_id: confirmedProposal.reschedule_source_schedule_id }
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

    if (confirmedProposal.reschedule_source_schedule_id) {
      const overrideUpdate = await tx.visitScheduleOverride.updateMany({
        where: {
          org_id: ctx.orgId,
          source_schedule_id: confirmedProposal.reschedule_source_schedule_id,
          status: 'pending',
          approved_at: { not: null },
          source_schedule: {
            is: {
              schedule_status: 'rescheduled',
            },
          },
        },
        data: {
          status: 'completed',
          replacement_schedule_id: schedule.id,
          after_snapshot: buildVisitScheduleSnapshot(schedule),
        },
      });
      if (overrideUpdate.count !== 1) {
        throw new VisitProposalOverrideStateChangedError();
      }
    }

    await createAuditLogEntry(tx, ctx, {
      action: 'visit_schedule_confirmed',
      targetType: 'VisitSchedule',
      targetId: schedule.id,
      changes: {
        proposal_id: id,
        reschedule_source_schedule_id: existing.reschedule_source_schedule_id,
        vehicle_resource_id: existing.vehicle_resource_id ?? null,
      },
    });

    if (operatingDayOverrideAudit) {
      await createAuditLogEntry(tx, ctx, {
        action: 'visit_schedule_operating_day_override_applied',
        targetType: 'VisitSchedule',
        targetId: schedule.id,
        patientId: confirmedProposal.case_.patient_id,
        changes: {
          case_id: confirmedProposal.case_id,
          cycle_id: confirmedProposal.cycle_id ?? null,
          proposal_id: id,
          scheduled_date: scheduledDateKey,
          pharmacist_id: confirmedProposal.proposed_pharmacist_id,
          site_id: operatingDayOverrideAudit.siteId,
          operating_day_reason: operatingDayOverrideAudit.reason,
          override_reason: operatingDayOverrideAudit.overrideReason,
          recurrence_rule: confirmedProposal.suggested_recurrence_rule ?? null,
        },
      });
    }

    await resolveOperationalTasks(tx, {
      orgId: ctx.orgId,
      dedupeKey: buildVisitScheduleContactTaskKey(id),
      status: 'completed',
    });

    return { proposal, schedule, alreadyFinalized: false };
  }).catch((cause: unknown) => {
    if (cause instanceof VisitProposalConfirmTimeConflictError) {
      return {
        error: 'time_conflict' as const,
        conflictKind: cause.conflictKind,
      };
    }
    if (cause instanceof VisitProposalConfirmDuplicateActiveScheduleError) {
      return {
        error: 'duplicate_active_schedule' as const,
      };
    }
    if (cause instanceof VisitProposalOverrideStateChangedError) {
      return {
        error: 'override_state_changed' as const,
      };
    }
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
    if (result.error === 'override_state_changed') {
      return conflict('確定済み訪問の変更承認が同時に更新されました。再読み込みしてください');
    }
    if (result.error === 'source_schedule_state_changed') {
      return conflict('元の訪問予定が変更済みです。再読み込みしてください');
    }
    if (result.error === 'state_changed') {
      return conflict('この候補はすでに確定または変更されています。再読み込みしてください');
    }
    if (result.error === 'time_conflict') {
      return conflict(getVisitScheduleTimeConflictMessage(result.conflictKind));
    }
    if (result.error === 'duplicate_active_schedule') {
      return conflict('同一ケース・同一日付の訪問予定が既に存在します。既存予定を確認してください');
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
    if (result.error === 'operating_day_closed') {
      return validationError(result.message);
    }
    if (result.error === 'billing_cap_exceeded') {
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

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, context));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
