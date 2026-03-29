import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { upsertVisitPreparationSchema } from '@/lib/validations/visit-preparation';
import {
  describeOperationalTask,
  upsertOperationalTask,
  resolveOperationalTasks,
} from '@/server/services/operational-tasks';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import {
  getPatientHomeCareFeatureSummary,
  selectScheduleHomeCareFeatureHighlights,
} from '@/server/services/home-care-ops';
import { getScheduleVisitBrief } from '@/server/services/visit-brief';

type IntakeLineSummary = {
  drug_name: string;
  drug_code: string | null;
  dose: string;
  frequency: string;
  days: number;
};

function lineIdentity(line: IntakeLineSummary) {
  return line.drug_code?.trim() || line.drug_name.trim();
}

function summarizePrescriptionChanges(
  currentLines: IntakeLineSummary[],
  previousLines: IntakeLineSummary[]
) {
  const previousByKey = new Map(previousLines.map((line) => [lineIdentity(line), line]));
  const currentKeys = new Set<string>();

  const added: string[] = [];
  const changed: Array<{ drug_name: string; reasons: string[] }> = [];

  for (const line of currentLines) {
    const key = lineIdentity(line);
    currentKeys.add(key);
    const previous = previousByKey.get(key);
    if (!previous) {
      added.push(line.drug_name);
      continue;
    }

    const reasons: string[] = [];
    if (previous.dose !== line.dose) reasons.push(`用量 ${previous.dose} → ${line.dose}`);
    if (previous.frequency !== line.frequency) {
      reasons.push(`用法 ${previous.frequency} → ${line.frequency}`);
    }
    if (previous.days !== line.days) reasons.push(`日数 ${previous.days}日 → ${line.days}日`);

    if (reasons.length > 0) {
      changed.push({
        drug_name: line.drug_name,
        reasons,
      });
    }
  }

  const removed = previousLines
    .filter((line) => !currentKeys.has(lineIdentity(line)))
    .map((line) => line.drug_name);

  return {
    added,
    changed,
    removed,
  };
}

function buildPreparationTaskKey(scheduleId: string) {
  return `visit-preparation:${scheduleId}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問準備情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { scheduleId } = await params;
  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: scheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      scheduled_date: true,
      time_window_start: true,
      time_window_end: true,
      schedule_status: true,
      priority: true,
      pharmacist_id: true,
      assignment_mode: true,
      escalation_reason: true,
      confirmed_at: true,
      site: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
      preparation: true,
      override_request: {
        select: {
          id: true,
          status: true,
          reason: true,
          impact_summary: true,
        },
      },
      applied_override: {
        select: {
          id: true,
          reason: true,
          source_schedule: {
            select: {
              scheduled_date: true,
              time_window_start: true,
              time_window_end: true,
              pharmacist_id: true,
            },
          },
        },
      },
      case_: {
        select: {
          id: true,
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
          required_visit_support: true,
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
                },
              },
              contacts: {
                where: { is_emergency_contact: true },
                select: {
                  id: true,
                  name: true,
                  relation: true,
                  phone: true,
                },
              },
              consents: {
                where: {
                  consent_type: 'visit_medication_management',
                  is_active: true,
                  revoked_date: null,
                },
                select: { id: true },
              },
              scheduling_preference: {
                select: {
                  visit_before_contact_required: true,
                  first_visit_preferred_date: true,
                  first_visit_time_slot: true,
                  first_visit_time_note: true,
                  parking_available: true,
                  primary_contact_preference: true,
                  mcs_linked: true,
                },
              },
            },
          },
          care_team_links: {
            orderBy: { role: 'asc' },
            select: {
              id: true,
              role: true,
              name: true,
              organization_name: true,
              phone: true,
            },
          },
          management_plans: {
            where: { status: 'approved' },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  if (!schedule) return notFound('訪問予定が見つかりません');

  const preparation = schedule.preparation;
  const primaryResidence = schedule.case_.patient.residences[0] ?? null;

  const caseData = schedule.case_;
  const patient = caseData.patient;

  const [
    previousVisit,
    openTasks,
    recentContactLogs,
    sameDaySchedules,
    billingEvidence,
    recentPrescriptionIntakes,
    firstVisitDoc,
  ] =
    await Promise.all([
    prisma.visitRecord.findFirst({
      where: {
        org_id: ctx.orgId,
        schedule: {
          case_id: schedule.case_id,
        },
        schedule_id: {
          not: schedule.id,
        },
      },
      orderBy: {
        visit_date: 'desc',
      },
      select: {
        id: true,
        visit_date: true,
        outcome_status: true,
        soap_plan: true,
        next_visit_suggestion_date: true,
      },
    }),
    prisma.task.findMany({
      where: {
        org_id: ctx.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        OR: [
          {
            related_entity_type: 'visit_schedule',
            related_entity_id: schedule.id,
          },
          {
            related_entity_type: 'case',
            related_entity_id: schedule.case_id,
          },
        ],
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: 6,
      select: {
        id: true,
        task_type: true,
        title: true,
        description: true,
        priority: true,
        assigned_to: true,
        due_date: true,
        sla_due_at: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    }),
    prisma.visitScheduleContactLog.findMany({
      where: {
        org_id: ctx.orgId,
        OR: [
          { schedule_id: schedule.id },
          { case_id: schedule.case_id },
        ],
      },
      orderBy: [{ called_at: 'desc' }],
      take: 4,
      select: {
        id: true,
        outcome: true,
        contact_name: true,
        contact_phone: true,
        note: true,
        callback_due_at: true,
        called_at: true,
        called_by: true,
      },
    }),
    prisma.visitSchedule.findMany({
      where: {
        org_id: ctx.orgId,
        scheduled_date: schedule.scheduled_date,
        pharmacist_id: schedule.pharmacist_id,
        id: {
          not: schedule.id,
        },
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
      },
      orderBy: [{ time_window_start: 'asc' }],
      select: {
        id: true,
        route_order: true,
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
                    building_id: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    listBillingEvidenceBlockers(prisma, {
      orgId: ctx.orgId,
      patientId: schedule.case_.patient.id,
      limit: 4,
    }),
    prisma.prescriptionIntake.findMany({
      where: {
        org_id: ctx.orgId,
        cycle: {
          patient_id: schedule.case_.patient.id,
        },
      },
      orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
      take: 2,
      select: {
        id: true,
        source_type: true,
        prescribed_date: true,
        lines: {
          orderBy: { line_number: 'asc' },
          select: {
            drug_name: true,
            drug_code: true,
            dose: true,
            frequency: true,
            days: true,
          },
        },
      },
    }),
    prisma.firstVisitDocument.findFirst({
      where: {
        org_id: ctx.orgId,
        case_id: schedule.case_id,
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        delivered_at: true,
        delivered_to: true,
      },
    }),
  ]);

  const onboarding_readiness = {
    consent_obtained: (patient.consents?.length ?? 0) > 0,
    emergency_contact_set: (patient.contacts?.length ?? 0) > 0,
    first_visit_doc_delivered: firstVisitDoc?.delivered_at != null,
    management_plan_approved: (caseData.management_plans?.length ?? 0) > 0,
    primary_physician_set:
      caseData.care_team_links?.some((l) => l.role === 'physician') ?? false,
  };

  // HVI-01C: build intake_context from home_visit_intake JSON and scheduling_preference
  const rawVisitSupport = caseData.required_visit_support as Record<string, unknown> | null;
  const intakeData = (
    rawVisitSupport?.home_visit_intake != null &&
    typeof rawVisitSupport.home_visit_intake === 'object'
      ? rawVisitSupport.home_visit_intake
      : {}
  ) as Record<string, unknown>;
  const schedulingPref = patient.scheduling_preference;

  const intake_context = {
    // From scheduling_preference (structured, HVI-01B)
    visit_before_contact_required: schedulingPref?.visit_before_contact_required ?? null,
    first_visit_preferred_date:
      schedulingPref?.first_visit_preferred_date instanceof Date
        ? schedulingPref.first_visit_preferred_date.toISOString().split('T')[0]
        : (schedulingPref?.first_visit_preferred_date as string | null | undefined) ?? null,
    first_visit_time_slot: schedulingPref?.first_visit_time_slot ?? null,
    first_visit_time_note: schedulingPref?.first_visit_time_note ?? null,
    parking_available: schedulingPref?.parking_available ?? null,
    primary_contact_preference: schedulingPref?.primary_contact_preference ?? null,
    mcs_linked: schedulingPref?.mcs_linked ?? null,

    // From home_visit_intake JSON (CareCase.required_visit_support)
    money_management: (intakeData.money_management as string | null | undefined) ?? null,
    family_key_person: (intakeData.family_key_person as string | null | undefined) ?? null,
    care_level: (intakeData.care_level as string | null | undefined) ?? null,
    adl_level: (intakeData.adl_level as string | null | undefined) ?? null,
    dementia_level: (intakeData.dementia_level as string | null | undefined) ?? null,
    special_medical_procedures: Array.isArray(intakeData.special_medical_procedures)
      ? (intakeData.special_medical_procedures as string[])
      : [],
    special_medical_notes:
      (intakeData.special_medical_notes as string | null | undefined) ?? null,
    ent_prescription: (intakeData.ent_prescription as string | null | undefined) ?? null,
    narcotics_base: (intakeData.narcotics_base as string | null | undefined) ?? null,
    narcotics_rescue: (intakeData.narcotics_rescue as string | null | undefined) ?? null,
    infection_isolation: (intakeData.infection_isolation as string | null | undefined) ?? null,
    residual_medication_status:
      (intakeData.residual_medication_status as string | null | undefined) ?? null,
    medication_support_methods: Array.isArray(intakeData.medication_support_methods)
      ? (intakeData.medication_support_methods as string[])
      : [],
  };

  const sameFacilitySchedules = sameDaySchedules.filter((item) => {
    const residence = item.case_.patient.residences[0] ?? null;
    if (!primaryResidence || !residence) return false;
    if (primaryResidence.building_id && residence.building_id) {
      return primaryResidence.building_id === residence.building_id;
    }
    return primaryResidence.address === residence.address;
  });

  const readinessBlockers = [
    !preparation?.medication_changes_reviewed ? '薬歴・前回変更の確認' : null,
    !preparation?.carry_items_confirmed ? '持参薬・物品確認' : null,
    !preparation?.previous_issues_reviewed ? '前回課題の確認' : null,
    !preparation?.route_confirmed ? 'ルート確認' : null,
    !preparation?.offline_synced ? 'オフライン同期確認' : null,
  ].filter((value): value is string => value != null);
  const homeCareFeatureSummary = await getPatientHomeCareFeatureSummary(prisma, {
    orgId: ctx.orgId,
    patientId: schedule.case_.patient.id,
  });
  const visitBrief = await getScheduleVisitBrief(prisma, {
    orgId: ctx.orgId,
    patientId: schedule.case_.patient.id,
  });
  const latestIntake = recentPrescriptionIntakes[0] ?? null;
  const previousIntake = recentPrescriptionIntakes[1] ?? null;
  const prescriptionChanges =
    latestIntake && previousIntake
      ? {
          current_prescribed_date: latestIntake.prescribed_date.toISOString(),
          previous_prescribed_date: previousIntake.prescribed_date.toISOString(),
          source_type: latestIntake.source_type,
          ...summarizePrescriptionChanges(latestIntake.lines, previousIntake.lines),
        }
      : latestIntake
        ? {
            current_prescribed_date: latestIntake.prescribed_date.toISOString(),
            previous_prescribed_date: null,
            source_type: latestIntake.source_type,
            added: latestIntake.lines.map((line) => line.drug_name),
            changed: [],
            removed: [],
          }
        : null;

  return success({
    data: {
      preparation,
      pack: {
        patient: {
          id: schedule.case_.patient.id,
          name: schedule.case_.patient.name,
          address: primaryResidence?.address ?? null,
        },
        visit: {
          id: schedule.id,
          scheduled_date: schedule.scheduled_date.toISOString(),
          time_window_start: schedule.time_window_start?.toISOString() ?? null,
          time_window_end: schedule.time_window_end?.toISOString() ?? null,
          schedule_status: schedule.schedule_status,
          priority: schedule.priority,
          confirmed_at: schedule.confirmed_at?.toISOString() ?? null,
        },
        site: schedule.site,
        handoff: {
          assignment_mode: schedule.assignment_mode,
          summary: [
            ...(schedule.assignment_mode === 'fallback'
              ? ['代替担当での訪問です']
              : []),
            ...(schedule.escalation_reason ? [schedule.escalation_reason] : []),
            ...(schedule.override_request?.status === 'pending'
              ? [`変更承認待ち: ${schedule.override_request.reason}`]
              : []),
            ...(schedule.applied_override
              ? [`例外変更理由: ${schedule.applied_override.reason}`]
              : []),
          ].join(' / '),
        },
        readiness_blockers: readinessBlockers,
        previous_visit: previousVisit
          ? {
              id: previousVisit.id,
              visit_date: previousVisit.visit_date.toISOString(),
              outcome_status: previousVisit.outcome_status,
              soap_plan: previousVisit.soap_plan,
              next_visit_suggestion_date:
                previousVisit.next_visit_suggestion_date?.toISOString() ?? null,
            }
          : null,
        open_tasks: openTasks.map((task) => {
          const detail = describeOperationalTask(task);
          return {
            id: task.id,
            task_type: task.task_type,
            title: task.title,
            description: task.description,
            priority: task.priority,
            due_at: task.sla_due_at?.toISOString() ?? task.due_date?.toISOString() ?? null,
            action_href: detail.actionHref,
            action_label: detail.actionLabel,
          };
        }),
        recent_contact_logs: recentContactLogs.map((log) => ({
          ...log,
          callback_due_at: log.callback_due_at?.toISOString() ?? null,
          called_at: log.called_at.toISOString(),
        })),
        facility_mode: {
          label: primaryResidence?.building_id ?? primaryResidence?.address ?? null,
          same_day_patient_count: sameFacilitySchedules.length + 1,
          same_day_patient_names: [
            schedule.case_.patient.name,
            ...sameFacilitySchedules.map((item) => item.case_.patient.name),
          ],
          route_orders: [
            ...sameDaySchedules.map((item) => item.route_order),
          ].filter((value): value is number => typeof value === 'number'),
        },
        workload: {
          same_day_visit_count: sameDaySchedules.length + 1,
        },
        care_team: schedule.case_.care_team_links,
        billing_blockers: billingEvidence.flatMap((item) =>
          item.blockers.map((blocker) => ({
            evidence_id: item.id,
            visit_record_id: item.visit_record_id,
            ...blocker,
          }))
        ),
        prescription_changes: prescriptionChanges,
        home_care_feature_highlights:
          selectScheduleHomeCareFeatureHighlights(homeCareFeatureSummary),
        visit_brief: visitBrief,
        onboarding_readiness,
        intake_context,
        emergency_contacts: patient.contacts ?? [],
        first_visit_document: firstVisitDoc
          ? {
              delivered_at: firstVisitDoc.delivered_at?.toISOString() ?? null,
              delivered_to: firstVisitDoc.delivered_to ?? null,
            }
          : null,
      },
    },
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問準備情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = upsertVisitPreparationSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { scheduleId } = await params;
  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: scheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      schedule_status: true,
      scheduled_date: true,
      pharmacist_id: true,
    },
  });
  if (!schedule) return notFound('訪問予定が見つかりません');

  const allChecklistComplete =
    parsed.data.medication_changes_reviewed &&
    parsed.data.carry_items_confirmed &&
    parsed.data.previous_issues_reviewed &&
    parsed.data.route_confirmed &&
    parsed.data.offline_synced;

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    const preparation = await tx.visitPreparation.upsert({
      where: {
        schedule_id: schedule.id,
      },
      create: {
        org_id: ctx.orgId,
        schedule_id: schedule.id,
        checklist: parsed.data.checklist as Prisma.InputJsonValue,
        medication_changes_reviewed: parsed.data.medication_changes_reviewed,
        carry_items_confirmed: parsed.data.carry_items_confirmed,
        previous_issues_reviewed: parsed.data.previous_issues_reviewed,
        route_confirmed: parsed.data.route_confirmed,
        offline_synced: parsed.data.offline_synced,
        prepared_by: ctx.userId,
        prepared_at: allChecklistComplete ? new Date() : null,
      },
      update: {
        checklist: parsed.data.checklist as Prisma.InputJsonValue,
        medication_changes_reviewed: parsed.data.medication_changes_reviewed,
        carry_items_confirmed: parsed.data.carry_items_confirmed,
        previous_issues_reviewed: parsed.data.previous_issues_reviewed,
        route_confirmed: parsed.data.route_confirmed,
        offline_synced: parsed.data.offline_synced,
        prepared_by: ctx.userId,
        prepared_at: allChecklistComplete ? new Date() : null,
      },
    });

    if (allChecklistComplete) {
      await resolveOperationalTasks(tx, {
        orgId: ctx.orgId,
        dedupeKey: buildPreparationTaskKey(schedule.id),
        status: 'completed',
      });
    } else {
      await upsertOperationalTask(tx, {
        orgId: ctx.orgId,
        taskType: 'visit_preparation',
        title: '訪問準備が未完了です',
        description: '訪問前チェックリストを完了してください。',
        priority: 'high',
        assignedTo: schedule.pharmacist_id,
        dueDate: schedule.scheduled_date,
        slaDueAt: schedule.scheduled_date,
        relatedEntityType: 'visit_schedule',
        relatedEntityId: schedule.id,
        dedupeKey: buildPreparationTaskKey(schedule.id),
      });
    }

    return preparation;
  });

  return success({ data: result });
}
