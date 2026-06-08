import { addDays, format, parseISO } from 'date-fns';
import { NextRequest } from 'next/server';
import type { ScheduleStatus, VisitAssignmentMode, VisitPriority, VisitType } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { buildVisitScheduleAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { z } from 'zod';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';
import { buildVisitScheduleSnapshot } from '@/server/services/visit-schedule-audit';
import {
  formatVisitWorkflowGateIssues,
  type VisitWorkflowGateIssue,
} from '@/server/services/management-plans';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import type { HomeVisitIntake } from '@/lib/patient/home-visit-intake';
import { fetchEmergencyContacts } from '@/lib/patient/emergency-contacts';
import {
  buildVisitScheduleCommunicationTargets,
  resolveVisitScheduleCommunicationChannel,
  toVisitScheduleCommunicationEventChannel,
  type VisitScheduleSchedulingPreferenceContext,
  visitScheduleCommunicationChannelValues,
} from '@/server/services/visit-schedule-communication';

const rescheduleSchema = z.object({
  reason: z.string().min(1, 'リスケ理由は必須です'),
  reason_code: z
    .enum([
      'emergency_insert',
      'pharmacist_unavailable',
      'patient_request',
      'facility_request',
      'weather',
      'other',
    ])
    .default('other'),
  communication_channel: z.enum(visitScheduleCommunicationChannelValues).default('phone'),
  communication_result: z.enum(['pending', 'sent', 'verbal_notified']).default('pending'),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  priority: z.enum(['normal', 'urgent', 'emergency']).optional(),
  preferred_pharmacist_id: z.string().trim().min(1).optional(),
  vehicle_resource_id: z.union([z.string().trim().min(1), z.null()]).optional(),
});

const RESCHEDULE_REASON_LABELS: Record<z.infer<typeof rescheduleSchema>['reason_code'], string> = {
  emergency_insert: '緊急訪問の割込み',
  pharmacist_unavailable: '担当薬剤師不在',
  patient_request: '患者都合',
  facility_request: '施設都合',
  weather: '天候・交通事情',
  other: 'その他',
};

type RescheduleSourceSchedule = {
  id: string;
  case_id: string;
  cycle_id: string | null;
  site_id: string | null;
  visit_type: VisitType;
  priority: VisitPriority;
  scheduled_date: Date;
  time_window_start: Date | null;
  time_window_end: Date | null;
  pharmacist_id: string;
  assignment_mode: VisitAssignmentMode;
  route_order: number | null;
  vehicle_resource_id: string | null;
  schedule_status: ScheduleStatus;
  confirmed_at: Date | null;
  confirmed_by: string | null;
  case_: {
    patient_id: string;
    patient: {
      name: string;
    };
  };
};

type ImpactedSchedule = RescheduleSourceSchedule & {
  override_request: {
    id: string;
    status: 'pending' | 'completed' | 'cancelled';
  } | null;
};

function toTimeString(value: Date | null) {
  return timeDateToString(value);
}

function resolveRequestedVehicleResourceId(
  requestedVehicleResourceId: string | null | undefined,
  currentVehicleResourceId: string | null,
) {
  if (requestedVehicleResourceId === null) return undefined;
  return requestedVehicleResourceId ?? currentVehicleResourceId ?? undefined;
}

function resolvePreferredReschedulePharmacistId(
  requestedPharmacistId: string | undefined,
  currentPharmacistId: string,
  reasonCode: z.infer<typeof rescheduleSchema>['reason_code'],
) {
  if (requestedPharmacistId) return requestedPharmacistId;
  if (reasonCode === 'pharmacist_unavailable') return undefined;
  return currentPharmacistId;
}

function isPotentiallyImpactedByEmergencyInsert(
  source: Pick<
    RescheduleSourceSchedule,
    'id' | 'route_order' | 'time_window_start' | 'time_window_end'
  >,
  candidate: Pick<ImpactedSchedule, 'id' | 'route_order' | 'time_window_start'>,
) {
  if (candidate.id === source.id) return false;

  if (source.route_order != null && candidate.route_order != null) {
    return candidate.route_order >= source.route_order;
  }

  if (source.time_window_start && candidate.time_window_start) {
    return candidate.time_window_start >= source.time_window_start;
  }

  if (source.time_window_end && candidate.time_window_start) {
    return candidate.time_window_start >= source.time_window_end;
  }

  return true;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定のリスケ権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問予定IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = rescheduleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const assignmentWhere = buildVisitScheduleAssignmentWhere(ctx);

  const schedule = (await prisma.visitSchedule.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    select: {
      id: true,
      case_id: true,
      cycle_id: true,
      site_id: true,
      visit_type: true,
      priority: true,
      scheduled_date: true,
      time_window_start: true,
      time_window_end: true,
      pharmacist_id: true,
      assignment_mode: true,
      route_order: true,
      vehicle_resource_id: true,
      schedule_status: true,
      confirmed_at: true,
      confirmed_by: true,
      case_: {
        select: {
          patient_id: true,
          required_visit_support: true,
          patient: {
            select: {
              name: true,
              scheduling_preference: {
                select: {
                  visit_before_contact_required: true,
                  mcs_linked: true,
                  primary_contact_preference: true,
                },
              },
            },
          },
        },
      },
    },
  })) as
    | (RescheduleSourceSchedule & {
        case_: RescheduleSourceSchedule['case_'] & {
          required_visit_support: unknown;
          patient: RescheduleSourceSchedule['case_']['patient'] & {
            scheduling_preference: {
              visit_before_contact_required: boolean | null;
              mcs_linked: boolean | null;
              primary_contact_preference: string | null;
            } | null;
          };
        };
      })
    | null;
  if (!schedule) return notFound('訪問予定が見つかりません');

  // Build scheduling preference context from structured fields + JSON intake
  const schedulingPref = schedule.case_.patient.scheduling_preference;
  const intakeJson = schedule.case_.required_visit_support as {
    home_visit_intake?: HomeVisitIntake;
  } | null;
  const intake = intakeJson?.home_visit_intake;
  const schedulingPreference: VisitScheduleSchedulingPreferenceContext = {
    preferredContactMethod:
      intake?.requester?.preferred_contact_method ??
      schedulingPref?.primary_contact_preference ??
      null,
    visitBeforeContactRequired:
      schedulingPref?.visit_before_contact_required ??
      intake?.visit_before_contact_required ??
      false,
    mcsLinked: schedulingPref?.mcs_linked ?? intake?.mcs_linked ?? false,
    pharmacyDecisionDueDate: intake?.requester?.pharmacy_decision_due_date
      ? parseISO(intake.requester.pharmacy_decision_due_date)
      : null,
  };

  if (['completed', 'cancelled', 'rescheduled'].includes(schedule.schedule_status)) {
    return validationError('この訪問予定はリスケできません');
  }

  const requestedVehicleResourceId = resolveRequestedVehicleResourceId(
    parsed.data.vehicle_resource_id,
    schedule.vehicle_resource_id,
  );
  const vehicleReassignmentMode =
    parsed.data.vehicle_resource_id === null
      ? 'auto'
      : parsed.data.vehicle_resource_id
        ? 'requested'
        : 'preserve_current';
  const preferredPharmacistId = resolvePreferredReschedulePharmacistId(
    parsed.data.preferred_pharmacist_id,
    schedule.pharmacist_id,
    parsed.data.reason_code,
  );

  let drafts;
  try {
    drafts = (
      await generateVisitScheduleProposalDrafts({
        orgId: ctx.orgId,
        caseId: schedule.case_id,
        visitType: schedule.visit_type,
        priority: parsed.data.priority ?? schedule.priority,
        candidateCount: 3,
        startDate: parsed.data.start_date
          ? new Date(parsed.data.start_date)
          : addDays(schedule.scheduled_date, 1),
        preferredTimeFrom: toTimeString(schedule.time_window_start),
        preferredTimeTo: toTimeString(schedule.time_window_end),
        preferredPharmacistId,
        vehicleResourceId: requestedVehicleResourceId,
        rescheduleSourceScheduleId: id,
      })
    ).drafts;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('VISIT_WORKFLOW_GATE:')) {
      const issues = error.message
        .replace('VISIT_WORKFLOW_GATE:', '')
        .split(',')
        .filter(Boolean) as VisitWorkflowGateIssue[];
      return validationError(formatVisitWorkflowGateIssues(issues));
    }
    throw error;
  }

  if (drafts.length === 0) {
    return validationError('リスケ候補を生成できませんでした');
  }

  const proposals = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const requestedAt = new Date();
      let impactedScheduleCount = await tx.visitSchedule.count({
        where: {
          org_id: ctx.orgId,
          pharmacist_id: schedule.pharmacist_id,
          scheduled_date: schedule.scheduled_date,
          schedule_status: {
            notIn: ['cancelled', 'rescheduled'],
          },
          id: { not: schedule.id },
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
      });

      const createdProposals = await Promise.all(
        drafts.map((draft) =>
          tx.visitScheduleProposal.create({
            data: {
              ...draft,
              proposal_reason: `${draft.proposal_reason} / リスケ理由: ${parsed.data.reason}`,
            },
          }),
        ),
      );

      const autoRescheduleSummary: Array<{
        schedule_id: string;
        patient_name: string;
        route_order: number | null;
        status:
          | 'proposed'
          | 'skipped_existing_override'
          | 'skipped_workflow_gate'
          | 'skipped_no_slot';
        proposal_ids: string[];
        reason?: string;
      }> = [];

      if (parsed.data.reason_code === 'emergency_insert') {
        const impactedSchedules = (await tx.visitSchedule.findMany({
          where: {
            org_id: ctx.orgId,
            pharmacist_id: schedule.pharmacist_id,
            scheduled_date: schedule.scheduled_date,
            schedule_status: {
              notIn: ['cancelled', 'rescheduled', 'completed'],
            },
            id: { not: schedule.id },
            ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
          },
          select: {
            id: true,
            case_id: true,
            cycle_id: true,
            site_id: true,
            visit_type: true,
            priority: true,
            scheduled_date: true,
            time_window_start: true,
            time_window_end: true,
            pharmacist_id: true,
            assignment_mode: true,
            route_order: true,
            vehicle_resource_id: true,
            schedule_status: true,
            confirmed_at: true,
            confirmed_by: true,
            override_request: {
              select: {
                id: true,
                status: true,
              },
            },
            case_: {
              select: {
                patient_id: true,
                patient: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: [{ route_order: 'asc' }, { time_window_start: 'asc' }],
        })) as ImpactedSchedule[];

        const impactedCandidates = impactedSchedules.filter((candidate) =>
          isPotentiallyImpactedByEmergencyInsert(schedule, candidate),
        );
        impactedScheduleCount = impactedCandidates.length;

        for (const impactedSchedule of impactedCandidates) {
          if (impactedSchedule.override_request?.status === 'pending') {
            autoRescheduleSummary.push({
              schedule_id: impactedSchedule.id,
              patient_name: impactedSchedule.case_.patient.name,
              route_order: impactedSchedule.route_order,
              status: 'skipped_existing_override',
              proposal_ids: [],
              reason: '既存の変更承認待ちがあるため自動再提案をスキップ',
            });
            continue;
          }

          let impactedDrafts;
          try {
            impactedDrafts = (
              await generateVisitScheduleProposalDrafts({
                orgId: ctx.orgId,
                caseId: impactedSchedule.case_id,
                visitType: impactedSchedule.visit_type,
                priority: impactedSchedule.priority,
                candidateCount: 1,
                startDate: schedule.scheduled_date,
                preferredTimeFrom: toTimeString(impactedSchedule.time_window_start),
                preferredTimeTo: toTimeString(impactedSchedule.time_window_end),
                preferredPharmacistId: impactedSchedule.pharmacist_id,
                vehicleResourceId: impactedSchedule.vehicle_resource_id ?? undefined,
                rescheduleSourceScheduleId: impactedSchedule.id,
              })
            ).drafts;
          } catch (error) {
            if (error instanceof Error && error.message.startsWith('VISIT_WORKFLOW_GATE:')) {
              autoRescheduleSummary.push({
                schedule_id: impactedSchedule.id,
                patient_name: impactedSchedule.case_.patient.name,
                route_order: impactedSchedule.route_order,
                status: 'skipped_workflow_gate',
                proposal_ids: [],
                reason: formatVisitWorkflowGateIssues(
                  error.message
                    .replace('VISIT_WORKFLOW_GATE:', '')
                    .split(',')
                    .filter(Boolean) as VisitWorkflowGateIssue[],
                ),
              });
              continue;
            }
            throw error;
          }

          if (impactedDrafts.length === 0) {
            autoRescheduleSummary.push({
              schedule_id: impactedSchedule.id,
              patient_name: impactedSchedule.case_.patient.name,
              route_order: impactedSchedule.route_order,
              status: 'skipped_no_slot',
              proposal_ids: [],
              reason: '代替候補の空き枠を見つけられませんでした',
            });
            continue;
          }

          await tx.visitScheduleProposal.updateMany({
            where: {
              org_id: ctx.orgId,
              reschedule_source_schedule_id: impactedSchedule.id,
              proposal_status: {
                in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
              },
            },
            data: {
              proposal_status: 'superseded',
            },
          });

          const createdImpactProposals = await Promise.all(
            impactedDrafts.map((draft) =>
              tx.visitScheduleProposal.create({
                data: {
                  ...draft,
                  proposal_reason: `${draft.proposal_reason} / 緊急割込影響: ${schedule.case_.patient.name} の差込対応`,
                },
              }),
            ),
          );

          await tx.visitScheduleOverride.create({
            data: {
              org_id: ctx.orgId,
              source_schedule_id: impactedSchedule.id,
              status: 'pending',
              reason: `緊急訪問割込みの影響で再調整が必要です（差込患者: ${schedule.case_.patient.name}）`,
              requested_by: ctx.userId,
              requested_at: requestedAt,
              before_snapshot: buildVisitScheduleSnapshot({
                ...impactedSchedule,
                confirmed_by: impactedSchedule.confirmed_by ?? null,
              }),
              impact_summary: {
                impacted_by_schedule_id: schedule.id,
                impacted_by_patient_id: schedule.case_.patient_id,
                impacted_by_patient_name: schedule.case_.patient.name,
                proposal_ids: createdImpactProposals.map((proposal) => proposal.id),
                reason_code: parsed.data.reason_code,
              },
              after_snapshot: createdImpactProposals.map((proposal) => ({
                proposal_id: proposal.id,
                proposed_date: proposal.proposed_date.toISOString(),
                time_window_start: proposal.time_window_start?.toISOString() ?? null,
                time_window_end: proposal.time_window_end?.toISOString() ?? null,
                proposed_pharmacist_id: proposal.proposed_pharmacist_id,
                vehicle_resource_id: proposal.vehicle_resource_id ?? null,
              })),
            },
          });

          autoRescheduleSummary.push({
            schedule_id: impactedSchedule.id,
            patient_name: impactedSchedule.case_.patient.name,
            route_order: impactedSchedule.route_order,
            status: 'proposed',
            proposal_ids: createdImpactProposals.map((proposal) => proposal.id),
          });
        }
      }

      const contacts = await tx.contactParty.findMany({
        where: {
          org_id: ctx.orgId,
          patient_id: schedule.case_.patient_id,
          relation: {
            in: [
              'self',
              'spouse',
              'child',
              'parent',
              'sibling',
              'other',
              'care_manager',
              'nurse',
              'facility_staff',
            ],
          },
        },
        select: {
          name: true,
          relation: true,
          phone: true,
          email: true,
          fax: true,
          is_primary: true,
        },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      });
      const careTeamLinks = await tx.careTeamLink.findMany({
        where: {
          org_id: ctx.orgId,
          case_id: schedule.case_id,
          role: { in: ['nurse', 'care_manager'] },
        },
        select: {
          role: true,
          name: true,
          phone: true,
          email: true,
          fax: true,
          is_primary: true,
        },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      });
      const communicationTargets = buildVisitScheduleCommunicationTargets({
        contacts,
        careTeamLinks,
        channel: parsed.data.communication_channel,
        schedulingPreference,
      });

      await tx.visitScheduleOverride.create({
        data: {
          org_id: ctx.orgId,
          source_schedule_id: schedule.id,
          status: 'pending',
          reason: parsed.data.reason,
          requested_by: ctx.userId,
          requested_at: requestedAt,
          before_snapshot: buildVisitScheduleSnapshot({
            ...schedule,
            confirmed_by: schedule.confirmed_by ?? null,
          }),
          impact_summary: {
            impacted_schedule_count: impactedScheduleCount,
            proposed_replacements:
              createdProposals.length +
              autoRescheduleSummary.reduce((sum, item) => sum + item.proposal_ids.length, 0),
            pharmacist_id: schedule.pharmacist_id,
            preferred_pharmacist_id: preferredPharmacistId ?? null,
            requested_vehicle_resource_id: requestedVehicleResourceId ?? null,
            current_vehicle_resource_id: schedule.vehicle_resource_id,
            vehicle_reassignment_mode: vehicleReassignmentMode,
            reason_code: parsed.data.reason_code,
            communication_channel: parsed.data.communication_channel,
            communication_result: parsed.data.communication_result,
            impacted_patient_names: autoRescheduleSummary.map((item) => item.patient_name),
            auto_reschedule_summary: autoRescheduleSummary,
          },
          after_snapshot: createdProposals.map((proposal) => ({
            proposal_id: proposal.id,
            proposed_date: proposal.proposed_date.toISOString(),
            time_window_start: proposal.time_window_start?.toISOString() ?? null,
            time_window_end: proposal.time_window_end?.toISOString() ?? null,
            proposed_pharmacist_id: proposal.proposed_pharmacist_id,
            vehicle_resource_id: proposal.vehicle_resource_id ?? null,
          })),
        },
      });

      // HVI-01F: SLA due date — prefer pharmacy_decision_due_date from intake when it falls
      // before the scheduled visit date, otherwise fall back to the scheduled date itself.
      const slaDueDate =
        schedulingPreference.pharmacyDecisionDueDate !== null &&
        schedulingPreference.pharmacyDecisionDueDate < schedule.scheduled_date
          ? schedulingPreference.pharmacyDecisionDueDate
          : schedule.scheduled_date;

      // HVI-01F: effective channel after applying intake preferred_contact_method
      const effectiveChannel = resolveVisitScheduleCommunicationChannel(
        parsed.data.communication_channel,
        schedulingPreference.preferredContactMethod,
      );

      if (communicationTargets.length > 0) {
        await Promise.all(
          communicationTargets.map((target) =>
            tx.communicationRequest.create({
              data: {
                org_id: ctx.orgId,
                patient_id: schedule.case_.patient_id,
                case_id: schedule.case_id,
                request_type: 'schedule_change',
                template_key:
                  target.key === 'mcs'
                    ? 'visit_reschedule_mcs_notification'
                    : 'visit_reschedule_notification',
                recipient_name: target.recipientName,
                recipient_role: target.recipientRole,
                related_entity_type: 'visit_schedule',
                related_entity_id: schedule.id,
                context_snapshot: {
                  reason_code: parsed.data.reason_code,
                  reason_label: RESCHEDULE_REASON_LABELS[parsed.data.reason_code],
                  reason: parsed.data.reason,
                  // HVI-01F: use effective channel (may be overridden by intake preferred_contact_method)
                  communication_channel: effectiveChannel,
                  communication_result: parsed.data.communication_result,
                  recipient_bucket: target.key,
                  recipient_contact: target.contact,
                  impacted_schedule_count: impactedScheduleCount,
                  proposal_ids: createdProposals.map((proposal) => proposal.id),
                  // HVI-01F: intake-derived scheduling preference metadata
                  preferred_contact_method: schedulingPreference.preferredContactMethod,
                  visit_before_contact_required: schedulingPreference.visitBeforeContactRequired,
                  mcs_linked: schedulingPreference.mcsLinked,
                  pharmacy_decision_due_date:
                    schedulingPreference.pharmacyDecisionDueDate?.toISOString() ?? null,
                },
                status: parsed.data.communication_result === 'pending' ? 'draft' : 'sent',
                subject: `訪問予定変更の連絡 (${RESCHEDULE_REASON_LABELS[parsed.data.reason_code]})`,
                // HVI-01F: prepend patient-contact-first flag when visit_before_contact_required
                content: schedulingPreference.visitBeforeContactRequired
                  ? `【要訪問前連絡】${format(schedule.scheduled_date, 'yyyy/MM/dd')} の訪問予定を変更します。訪問前に患者への連絡が必要です。理由: ${parsed.data.reason}`
                  : `${format(schedule.scheduled_date, 'yyyy/MM/dd')} の訪問予定を変更します。理由: ${parsed.data.reason}`,
                requested_by: ctx.userId,
                // HVI-01F: SLA due date from pharmacy_decision_due_date when available
                due_date: slaDueDate,
              },
            }),
          ),
        );
      }

      await tx.communicationEvent.create({
        data: {
          org_id: ctx.orgId,
          patient_id: schedule.case_.patient_id,
          case_id: schedule.case_id,
          event_type: 'schedule_change',
          // HVI-01F: reflect effective channel in the event record
          channel: toVisitScheduleCommunicationEventChannel(effectiveChannel),
          direction: 'outbound',
          subject: `訪問予定変更 (${RESCHEDULE_REASON_LABELS[parsed.data.reason_code]})`,
          content: schedulingPreference.visitBeforeContactRequired
            ? `【要訪問前連絡】${format(schedule.scheduled_date, 'yyyy/MM/dd')} の訪問予定を変更します。訪問前に患者への連絡が必要です。理由: ${parsed.data.reason}`
            : `${format(schedule.scheduled_date, 'yyyy/MM/dd')} の訪問予定を変更します。理由: ${parsed.data.reason}`,
          counterpart_name:
            communicationTargets.length > 0
              ? communicationTargets.map((target) => target.recipientName).join(' / ')
              : null,
          occurred_at: requestedAt,
        },
      });

      await upsertOperationalTask(tx, {
        orgId: ctx.orgId,
        taskType: 'visit_schedule_override_approval',
        title: schedulingPreference.visitBeforeContactRequired
          ? '【要訪問前連絡】確定済み訪問の変更承認が必要です'
          : '確定済み訪問の変更承認が必要です',
        description: parsed.data.reason,
        priority: parsed.data.priority === 'emergency' ? 'urgent' : 'high',
        dueDate: slaDueDate,
        // HVI-01F: use pharmacy_decision_due_date as SLA deadline when provided
        slaDueAt: slaDueDate,
        relatedEntityType: 'visit_schedule',
        relatedEntityId: schedule.id,
        dedupeKey: `visit-reschedule-approval:${schedule.id}`,
        assignedTo: null,
        metadata: {
          impacted_schedule_count: impactedScheduleCount,
          proposal_ids: createdProposals.map((proposal) => proposal.id),
          source_schedule_id: schedule.id,
          // HVI-01F: intake-derived scheduling metadata in task for approver context
          preferred_contact_method: schedulingPreference.preferredContactMethod,
          visit_before_contact_required: schedulingPreference.visitBeforeContactRequired,
          mcs_linked: schedulingPreference.mcsLinked,
          pharmacy_decision_due_date:
            schedulingPreference.pharmacyDecisionDueDate?.toISOString() ?? null,
        },
      });

      const approvers = await tx.membership.findMany({
        where: {
          org_id: ctx.orgId,
          is_active: true,
          role: { in: ['owner', 'admin'] },
        },
        select: {
          user_id: true,
        },
      });
      const approverIds = Array.from(new Set(approvers.map((approver) => approver.user_id)));
      if (approverIds.length > 0) {
        await tx.task.updateMany({
          where: {
            org_id: ctx.orgId,
            dedupe_key: `visit-reschedule-approval:${schedule.id}`,
          },
          data: {
            assigned_to: approverIds[0],
          },
        });
      }

      await dispatchNotificationEvent(tx, {
        orgId: ctx.orgId,
        eventType: 'visit_schedule_reschedule_requested',
        type: parsed.data.priority === 'emergency' ? 'urgent' : 'business',
        title: '確定済み訪問の変更承認待ち',
        message: `影響件数 ${impactedScheduleCount} 件。承認後に新候補を確定できます。`,
        link: '/schedules',
        explicitUserIds: approverIds,
        dedupeKey: `visit-reschedule-request:${schedule.id}`,
        metadata: {
          source_schedule_id: schedule.id,
          impacted_schedule_count: impactedScheduleCount,
          proposal_count: createdProposals.length,
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: ctx.orgId,
          actor_id: ctx.userId,
          action: 'visit_schedule_reschedule_requested',
          target_type: 'VisitSchedule',
          target_id: schedule.id,
          changes: {
            reason: parsed.data.reason,
            reason_code: parsed.data.reason_code,
            communication_channel: parsed.data.communication_channel,
            communication_result: parsed.data.communication_result,
            communication_target_count: communicationTargets.length,
            priority: parsed.data.priority ?? schedule.priority,
            proposals: createdProposals.map((proposal) => proposal.id),
            preferred_pharmacist_id: preferredPharmacistId ?? null,
            requested_vehicle_resource_id: requestedVehicleResourceId ?? null,
            current_vehicle_resource_id: schedule.vehicle_resource_id,
            vehicle_reassignment_mode: vehicleReassignmentMode,
          },
          ip_address: ctx.ipAddress,
          user_agent: ctx.userAgent,
        },
      });

      // FVD-01C: Fetch emergency contacts as SSOT for reschedule contact suggestions
      const emergencyContacts = await fetchEmergencyContacts(
        tx,
        ctx.orgId,
        schedule.case_.patient_id,
      );

      // FVD-01C: Fetch scheduling preference for UI-facing contact suggestion metadata
      const schedulingPreferenceRecord =
        typeof tx.patientSchedulePreference?.findFirst === 'function'
          ? await tx.patientSchedulePreference.findFirst({
              where: {
                org_id: ctx.orgId,
                patient_id: schedule.case_.patient_id,
              },
              select: {
                preferred_contact_name: true,
                preferred_contact_phone: true,
                primary_contact_preference: true,
                visit_before_contact_required: true,
                mcs_linked: true,
                phone_contact_from: true,
                phone_contact_to: true,
              },
            })
          : null;

      return { proposals: createdProposals, emergencyContacts, schedulingPreferenceRecord };
    },
    { requestContext: ctx },
  );

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'visit_schedules_reschedule_request', schedule_id: id },
  });

  return success(
    {
      data: {
        proposals: proposals.proposals,
        // FVD-01C: Emergency contacts (is_emergency_contact=true) as SSOT for contact suggestions
        // The UI should pre-fill reschedule notification targets from this list
        suggested_contacts: proposals.emergencyContacts,
        scheduling_preference: proposals.schedulingPreferenceRecord
          ? {
              preferred_contact_name: proposals.schedulingPreferenceRecord.preferred_contact_name,
              preferred_contact_phone: proposals.schedulingPreferenceRecord.preferred_contact_phone,
              primary_contact_preference:
                proposals.schedulingPreferenceRecord.primary_contact_preference,
              visit_before_contact_required:
                proposals.schedulingPreferenceRecord.visit_before_contact_required ?? false,
              mcs_linked: proposals.schedulingPreferenceRecord.mcs_linked ?? false,
              phone_contact_from: proposals.schedulingPreferenceRecord.phone_contact_from,
              phone_contact_to: proposals.schedulingPreferenceRecord.phone_contact_to,
            }
          : null,
        // HVI-01F: intake-derived scheduling metadata surfaced to UI
        intake_scheduling: {
          preferred_contact_method: schedulingPreference.preferredContactMethod,
          visit_before_contact_required: schedulingPreference.visitBeforeContactRequired,
          mcs_linked: schedulingPreference.mcsLinked,
          pharmacy_decision_due_date:
            schedulingPreference.pharmacyDecisionDueDate?.toISOString() ?? null,
        },
      },
    },
    201,
  );
}
