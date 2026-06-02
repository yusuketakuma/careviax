import { NextRequest } from 'next/server';
import { deriveFacilityLabel, deriveVisitPlaceGroup } from '@/lib/utils/facility';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound, forbiddenResponse } from '@/lib/api/response';
import { upsertVisitPreparationSchema } from '@/lib/validations/visit-preparation';
import {
  buildChecklistFromTemplate,
  mergeChecklistWithTemplate,
} from '@/lib/visits/checklist-template';
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
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';

type IntakeLineSummary = {
  drug_name: string;
  drug_code: string | null;
  dose: string;
  frequency: string;
  days: number;
  start_date: Date | null;
  end_date: Date | null;
};

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

function normalizeInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

type FacilityParallelSchedule = {
  id: string;
  route_order: number | null;
  schedule_status: string;
  medication_start_date: Date | null;
  medication_end_date: Date | null;
  preparation: {
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    offline_synced: boolean;
  } | null;
  visit_record: {
    id: string;
    outcome_status: string;
  } | null;
  case_: {
    patient: {
      id: string;
      name: string;
      name_kana: string | null;
      birth_date: Date | null;
      gender: string | null;
      residences: Array<{
        address: string;
        facility_id: string | null;
        facility_unit_id: string | null;
        building_id: string | null;
        unit_name: string | null;
      }>;
    };
  };
};

type ConferenceSectionSummary = {
  key: string;
  label?: string;
  body?: string;
};

type ConferenceParticipantSummary = {
  name?: string | null;
  role?: string | null;
};

type ConferenceSyncSummary = {
  billing_candidate_id?: string | null;
  visit_proposal_id?: string | null;
  report_draft_ids?: string[];
  tasks_created?: number;
  medication_issues_created?: number;
};

const VISIT_PREPARATION_CONFERENCE_NOTE_TYPES = new Set(['pre_discharge', 'service_manager']);
type VisitPreparationConferenceNoteType = 'pre_discharge' | 'service_manager';

function isVisitPreparationConferenceNoteType(
  value: string,
): value is VisitPreparationConferenceNoteType {
  return VISIT_PREPARATION_CONFERENCE_NOTE_TYPES.has(value);
}

function lineIdentity(line: IntakeLineSummary) {
  return line.drug_code?.trim() || line.drug_name.trim();
}

function summarizePrescriptionChanges(
  currentLines: IntakeLineSummary[],
  previousLines: IntakeLineSummary[],
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

function toDateString(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function countPreparationBlockers(preparation: FacilityParallelSchedule['preparation']) {
  return [
    !preparation?.medication_changes_reviewed,
    !preparation?.carry_items_confirmed,
    !preparation?.previous_issues_reviewed,
    !preparation?.route_confirmed,
    !preparation?.offline_synced,
  ].filter(Boolean).length;
}

function buildPreviousVisitSummary(
  previousVisit: {
    visit_date: Date;
    outcome_status: string;
    soap_plan: string | null;
    next_visit_suggestion_date: Date | null;
  } | null,
) {
  if (!previousVisit) return null;
  const parts = [
    `前回 ${toDateString(previousVisit.visit_date) ?? ''}`,
    `結果: ${previousVisit.outcome_status}`,
    previousVisit.soap_plan ? `計画: ${previousVisit.soap_plan}` : null,
    previousVisit.next_visit_suggestion_date
      ? `次回提案: ${toDateString(previousVisit.next_visit_suggestion_date)}`
      : null,
  ].filter((value): value is string => Boolean(value));
  return parts.join(' / ');
}

function buildPreparationTaskKey(scheduleId: string) {
  return `visit-preparation:${scheduleId}`;
}

function parseConferenceSections(value: Prisma.JsonValue | null): ConferenceSectionSummary[] {
  const sections = readJsonObject(value)?.sections;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section): ConferenceSectionSummary[] => {
    const record = readJsonObject(section);
    if (!record || typeof record.key !== 'string') return [];
    return [
      {
        key: record.key,
        label: typeof record.label === 'string' ? record.label : undefined,
        body: typeof record.body === 'string' ? record.body : undefined,
      },
    ];
  });
}

function parseConferenceParticipants(value: Prisma.JsonValue): ConferenceParticipantSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((participant): ConferenceParticipantSummary[] => {
    const record = readJsonObject(participant);
    if (!record) return [];
    return [
      {
        name: typeof record.name === 'string' ? record.name : null,
        role: typeof record.role === 'string' ? record.role : null,
      },
    ];
  });
}

function parseConferenceActionItems(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const record = readJsonObject(item);
      if (record) return typeof record.title === 'string' ? record.title.trim() : '';
      return '';
    })
    .filter((title) => title.length > 0);
}

function readConferenceSectionBody(sections: ConferenceSectionSummary[], keys: string[]) {
  for (const key of keys) {
    const body = sections.find((section) => section.key === key)?.body?.trim();
    if (body) return body;
  }
  return null;
}

function parseConferenceSyncSummary(value: Prisma.JsonValue | null): ConferenceSyncSummary | null {
  const sync = readJsonObject(readJsonObject(value)?.sync_summary);
  if (!sync) return null;
  return {
    billing_candidate_id:
      typeof sync.billing_candidate_id === 'string' ? sync.billing_candidate_id : null,
    visit_proposal_id: typeof sync.visit_proposal_id === 'string' ? sync.visit_proposal_id : null,
    report_draft_ids: Array.isArray(sync.report_draft_ids)
      ? sync.report_draft_ids.filter((id): id is string => typeof id === 'string')
      : undefined,
    tasks_created: typeof sync.tasks_created === 'number' ? sync.tasks_created : undefined,
    medication_issues_created:
      typeof sync.medication_issues_created === 'number'
        ? sync.medication_issues_created
        : undefined,
  };
}

function buildConferenceHighlights(
  noteType: VisitPreparationConferenceNoteType,
  sections: ConferenceSectionSummary[],
) {
  const keys =
    noteType === 'pre_discharge'
      ? [
          ['退院予定', ['target_discharge_date', 'discharge_plan', 'discharge_background']],
          ['退院時薬剤変更', ['medication_changes_on_discharge', 'medication_summary']],
          ['初回訪問計画', ['next_visit_plan']],
          ['役割分担', ['team_roles', 'care_team_roles']],
        ]
      : [
          ['ケアプラン変更', ['care_plan_changes', 'care_plan_update']],
          ['訪問調整', ['visit_schedule_adjustment', 'service_adjustments']],
          ['服薬レビュー', ['medication_review', 'medication_related_items']],
          ['連携事項', ['coordination_items', 'agreed_actions']],
        ];

  return keys
    .map(([label, sectionKeys]) => {
      const body = readConferenceSectionBody(sections, sectionKeys as string[]);
      if (!body) return null;
      return `${label}: ${body.replace(/\s+/g, ' ').slice(0, 120)}`;
    })
    .filter((value): value is string => value !== null);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問準備情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { scheduleId } = await params;
  const normalizedScheduleId = normalizeRequiredRouteParam(scheduleId);
  if (!normalizedScheduleId) return validationError('訪問予定IDが不正です');

  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: normalizedScheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      scheduled_date: true,
      time_window_start: true,
      time_window_end: true,
      visit_type: true,
      schedule_status: true,
      priority: true,
      pharmacist_id: true,
      facility_batch_id: true,
      facility_batch: {
        select: {
          notes: true,
        },
      },
      route_order: true,
      medication_start_date: true,
      medication_end_date: true,
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
      visit_record: {
        select: {
          id: true,
          outcome_status: true,
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
              name_kana: true,
              birth_date: true,
              gender: true,
              residences: {
                where: { is_primary: true },
                take: 1,
                select: {
                  address: true,
                  facility_id: true,
                  facility_unit_id: true,
                  building_id: true,
                  unit_name: true,
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
  if (!canAccessVisitScheduleAssignment(ctx, schedule)) {
    return forbiddenResponse('この訪問予定の準備情報を閲覧する権限がありません');
  }
  const canAccessParallelVisitContext =
    ctx.role === 'owner' || ctx.role === 'admin' || schedule.pharmacist_id === ctx.userId;

  const preparation = schedule.preparation;
  const primaryResidence = schedule.case_.patient.residences[0] ?? null;

  const caseData = schedule.case_;
  const patient = caseData.patient;

  const [scopedVisitRecords, scopedMedicationCycles] = await Promise.all([
    prisma.visitRecord.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: schedule.case_.patient.id,
        schedule: {
          case_id: schedule.case_id,
        },
      },
      select: { id: true },
    }),
    prisma.medicationCycle.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: schedule.case_.patient.id,
        case_id: schedule.case_id,
      },
      select: { id: true },
    }),
  ]);
  const scopedVisitRecordIds = scopedVisitRecords.map((item) => item.id);
  const scopedCycleIds = scopedMedicationCycles.map((item) => item.id);

  const [billingEvidence, recentPrescriptionIntakes, firstVisitDoc, recentConferenceNotes] =
    await Promise.all([
      listBillingEvidenceBlockers(prisma, {
        orgId: ctx.orgId,
        patientId: schedule.case_.patient.id,
        visitRecordIds: scopedVisitRecordIds,
        cycleIds: scopedCycleIds,
        limit: 4,
      }),
      prisma.prescriptionIntake.findMany({
        where: {
          org_id: ctx.orgId,
          cycle: {
            patient_id: schedule.case_.patient.id,
            case_id: schedule.case_id,
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
              start_date: true,
              end_date: true,
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
      prisma.conferenceNote.findMany({
        where: {
          org_id: ctx.orgId,
          note_type: {
            in: ['pre_discharge', 'service_manager'],
          },
          OR: [
            { case_id: schedule.case_id },
            { patient_id: schedule.case_.patient.id, case_id: null },
          ],
        },
        orderBy: [{ conference_date: 'desc' }, { updated_at: 'desc' }],
        take: 4,
        select: {
          id: true,
          note_type: true,
          title: true,
          conference_date: true,
          participants: true,
          structured_content: true,
          metadata: true,
          action_items: true,
        },
      }),
    ]);

  const [previousVisit, openTasks, recentContactLogs, sameDaySchedules] = await Promise.all([
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
        OR: [{ schedule_id: schedule.id }, { case_id: schedule.case_id }],
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
    canAccessParallelVisitContext
      ? prisma.visitSchedule.findMany({
          where: {
            org_id: ctx.orgId,
            scheduled_date: schedule.scheduled_date,
            pharmacist_id: schedule.pharmacist_id,
            id: {
              not: schedule.id,
            },
            schedule_status: {
              in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress', 'completed'],
            },
          },
          orderBy: [{ time_window_start: 'asc' }],
          select: {
            id: true,
            route_order: true,
            schedule_status: true,
            medication_start_date: true,
            medication_end_date: true,
            preparation: {
              select: {
                medication_changes_reviewed: true,
                carry_items_confirmed: true,
                previous_issues_reviewed: true,
                route_confirmed: true,
                offline_synced: true,
              },
            },
            visit_record: {
              select: {
                id: true,
                outcome_status: true,
              },
            },
            case_: {
              select: {
                patient: {
                  select: {
                    id: true,
                    name: true,
                    name_kana: true,
                    birth_date: true,
                    gender: true,
                    residences: {
                      where: { is_primary: true },
                      take: 1,
                      select: {
                        address: true,
                        facility_id: true,
                        facility_unit_id: true,
                        building_id: true,
                        unit_name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const onboarding_readiness = {
    consent_obtained: (patient.consents?.length ?? 0) > 0,
    emergency_contact_set: (patient.contacts?.length ?? 0) > 0,
    first_visit_doc_delivered: firstVisitDoc?.delivered_at != null,
    management_plan_approved: (caseData.management_plans?.length ?? 0) > 0,
    primary_physician_set: caseData.care_team_links?.some((l) => l.role === 'physician') ?? false,
  };

  // HVI-01C: build intake_context from home_visit_intake JSON and scheduling_preference
  const intakeData = getHomeVisitIntake(caseData.required_visit_support);
  const schedulingPref = patient.scheduling_preference;

  const intake_context = {
    // From scheduling_preference (structured, HVI-01B)
    visit_before_contact_required: schedulingPref?.visit_before_contact_required ?? null,
    first_visit_preferred_date:
      schedulingPref?.first_visit_preferred_date instanceof Date
        ? schedulingPref.first_visit_preferred_date.toISOString().split('T')[0]
        : ((schedulingPref?.first_visit_preferred_date as string | null | undefined) ?? null),
    first_visit_time_slot: schedulingPref?.first_visit_time_slot ?? null,
    first_visit_time_note: schedulingPref?.first_visit_time_note ?? null,
    parking_available: schedulingPref?.parking_available ?? null,
    primary_contact_preference: schedulingPref?.primary_contact_preference ?? null,
    mcs_linked: schedulingPref?.mcs_linked ?? null,

    // From home_visit_intake JSON (CareCase.required_visit_support)
    money_management: intakeData?.money_management ?? null,
    family_key_person: intakeData?.family_key_person ?? null,
    care_level: intakeData?.care_level ?? null,
    adl_level: intakeData?.adl_level ?? null,
    dementia_level: intakeData?.dementia_level ?? null,
    special_medical_procedures: intakeData?.special_medical_procedures ?? [],
    special_medical_notes: intakeData?.special_medical_notes ?? null,
    ent_prescription: intakeData?.ent_prescription ?? null,
    narcotics_base: intakeData?.narcotics_base ?? null,
    narcotics_rescue: intakeData?.narcotics_rescue ?? null,
    infection_isolation: intakeData?.infection_isolation ?? null,
    residual_medication_status: intakeData?.residual_medication_status ?? null,
    medication_support_methods: intakeData?.medication_support_methods ?? [],
    initial_transition_management_expected:
      intakeData?.initial_transition_management_expected ?? null,
  };

  const sameFacilitySchedules = sameDaySchedules.filter((item) => {
    const residence = item.case_.patient.residences[0] ?? null;
    const primaryGroup = deriveVisitPlaceGroup(primaryResidence ?? null);
    const targetGroup = deriveVisitPlaceGroup(residence ?? null);
    return Boolean(primaryGroup && targetGroup && primaryGroup.key === targetGroup.key);
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
    caseIds: [schedule.case_id],
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
  const medicationPeriod = {
    schedule_start_date: toDateString(schedule.medication_start_date),
    schedule_end_date: toDateString(schedule.medication_end_date),
    prescription_start_date:
      latestIntake?.lines
        .map((line) => line.start_date)
        .filter((value): value is Date => value != null)
        .sort((left, right) => left.getTime() - right.getTime())[0]
        ?.toISOString()
        .slice(0, 10) ?? null,
    prescription_end_date:
      latestIntake?.lines
        .map((line) => line.end_date)
        .filter((value): value is Date => value != null)
        .sort((left, right) => right.getTime() - left.getTime())[0]
        ?.toISOString()
        .slice(0, 10) ?? null,
  };
  const currentFacilitySchedule: FacilityParallelSchedule = {
    id: schedule.id,
    route_order: schedule.route_order,
    schedule_status: schedule.schedule_status,
    medication_start_date: schedule.medication_start_date,
    medication_end_date: schedule.medication_end_date,
    preparation: schedule.preparation
      ? {
          medication_changes_reviewed: schedule.preparation.medication_changes_reviewed,
          carry_items_confirmed: schedule.preparation.carry_items_confirmed,
          previous_issues_reviewed: schedule.preparation.previous_issues_reviewed,
          route_confirmed: schedule.preparation.route_confirmed,
          offline_synced: schedule.preparation.offline_synced,
        }
      : null,
    visit_record: schedule.visit_record,
    case_: {
      patient: {
        id: schedule.case_.patient.id,
        name: schedule.case_.patient.name,
        name_kana: schedule.case_.patient.name_kana,
        birth_date: schedule.case_.patient.birth_date,
        gender: schedule.case_.patient.gender,
        residences: schedule.case_.patient.residences.map((residence) => ({
          address: residence.address,
          facility_id: residence.facility_id,
          facility_unit_id: residence.facility_unit_id,
          building_id: residence.building_id,
          unit_name: residence.unit_name,
        })),
      },
    },
  };
  const facilityParallelSchedules = [currentFacilitySchedule, ...sameFacilitySchedules].sort(
    (left, right) => (left.route_order ?? 9999) - (right.route_order ?? 9999),
  );
  const facilityParallelContext =
    facilityParallelSchedules.length > 1
      ? {
          batch_id: schedule.facility_batch_id,
          label:
            deriveVisitPlaceGroup(primaryResidence ?? null)?.label ??
            deriveFacilityLabel(primaryResidence ?? null),
          place_kind: deriveVisitPlaceGroup(primaryResidence ?? null)?.kind ?? null,
          site_name: schedule.site?.name ?? null,
          common_notes: schedule.facility_batch?.notes ?? null,
          current_schedule_id: schedule.id,
          patients: facilityParallelSchedules.map((item) => {
            const residence = item.case_.patient.residences[0] ?? null;
            return {
              schedule_id: item.id,
              patient_id: item.case_.patient.id,
              patient_name: item.case_.patient.name,
              patient_name_kana: item.case_.patient.name_kana,
              patient_birth_date: toDateString(item.case_.patient.birth_date),
              patient_gender: item.case_.patient.gender,
              unit_name: residence?.unit_name ?? null,
              route_order: item.route_order,
              schedule_status: item.schedule_status,
              medication_start_date: toDateString(item.medication_start_date),
              medication_end_date: toDateString(item.medication_end_date),
              preparation_blockers_count: countPreparationBlockers(item.preparation),
              visit_record_id: item.visit_record?.id ?? null,
              visit_outcome_status: item.visit_record?.outcome_status ?? null,
            };
          }),
        }
      : null;
  const conferenceContext = recentConferenceNotes.flatMap((note) => {
    if (!isVisitPreparationConferenceNoteType(note.note_type)) {
      return [];
    }
    const noteType = note.note_type;
    const sections = parseConferenceSections(note.structured_content);
    const actionItemsFromSections = readConferenceSectionBody(sections, [
      'agreed_actions',
      'action_summary',
    ])
      ?.split('\n')
      .map((line) => line.replace(/^[\s\-*・]+/, '').trim())
      .filter((line) => line.length > 0);

    return {
      id: note.id,
      note_type: noteType,
      title: note.title,
      conference_date: note.conference_date.toISOString(),
      participants: parseConferenceParticipants(note.participants).map((participant) => ({
        name: participant.name ?? null,
        role: participant.role ?? null,
      })),
      highlights: buildConferenceHighlights(noteType, sections),
      action_items: [
        ...parseConferenceActionItems(note.action_items),
        ...(actionItemsFromSections ?? []),
      ].slice(0, 5),
      sync_summary: parseConferenceSyncSummary(note.metadata),
    };
  });

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
          visit_type: schedule.visit_type,
          schedule_status: schedule.schedule_status,
          priority: schedule.priority,
          confirmed_at: schedule.confirmed_at?.toISOString() ?? null,
        },
        site: schedule.site,
        handoff: {
          assignment_mode: schedule.assignment_mode,
          summary: [
            ...(schedule.assignment_mode === 'fallback' ? ['代替担当での訪問です'] : []),
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
              summary: buildPreviousVisitSummary(previousVisit),
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
          label: deriveFacilityLabel(primaryResidence ?? null),
          same_day_patient_count: sameFacilitySchedules.length + 1,
          same_day_patient_names: [
            schedule.case_.patient.name,
            ...sameFacilitySchedules.map((item) => item.case_.patient.name),
          ],
          route_orders: [...sameDaySchedules.map((item) => item.route_order)].filter(
            (value): value is number => typeof value === 'number',
          ),
        },
        facility_parallel_context: facilityParallelContext,
        workload: {
          same_day_visit_count: sameDaySchedules.length + 1,
        },
        care_team: schedule.case_.care_team_links,
        conference_context: conferenceContext,
        billing_blockers: billingEvidence.flatMap((item) =>
          item.blockers.map((blocker) => ({
            evidence_id: item.id,
            visit_record_id: item.visit_record_id,
            ...blocker,
          })),
        ),
        prescription_changes: prescriptionChanges,
        medication_period: medicationPeriod,
        home_care_feature_highlights:
          selectScheduleHomeCareFeatureHighlights(homeCareFeatureSummary),
        jahis_supplemental_records: visitBrief.jahis_supplemental_records,
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
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問準備情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { scheduleId } = await params;
  const normalizedScheduleId = normalizeRequiredRouteParam(scheduleId);
  if (!normalizedScheduleId) return validationError('訪問予定IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = upsertVisitPreparationSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: normalizedScheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      schedule_status: true,
      scheduled_date: true,
      pharmacist_id: true,
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
        },
      },
    },
  });
  if (!schedule) return notFound('訪問予定が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, schedule)) {
    return forbiddenResponse('この訪問予定の準備情報を更新する権限がありません');
  }

  const allChecklistComplete =
    parsed.data.medication_changes_reviewed &&
    parsed.data.carry_items_confirmed &&
    parsed.data.previous_issues_reviewed &&
    parsed.data.route_confirmed &&
    parsed.data.offline_synced;

  const templateOpts = parsed.data.template_options;
  const effectiveChecklist: Record<string, unknown> = templateOpts
    ? mergeChecklistWithTemplate(parsed.data.checklist, {
        narcoticsCarry: templateOpts.narcotics_carry,
        infectionControl: templateOpts.infection_control,
        coldChainRequired: templateOpts.cold_chain_required,
        facilityCustomItems: templateOpts.facility_custom_items,
      })
    : Object.keys(parsed.data.checklist).length === 0
      ? buildChecklistFromTemplate()
      : parsed.data.checklist;
  const normalizedChecklist = normalizeInputJsonObject(effectiveChecklist);

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    const preparation = await tx.visitPreparation.upsert({
      where: {
        schedule_id: schedule.id,
      },
      create: {
        org_id: ctx.orgId,
        schedule_id: schedule.id,
        checklist: normalizedChecklist,
        medication_changes_reviewed: parsed.data.medication_changes_reviewed,
        carry_items_confirmed: parsed.data.carry_items_confirmed,
        previous_issues_reviewed: parsed.data.previous_issues_reviewed,
        route_confirmed: parsed.data.route_confirmed,
        offline_synced: parsed.data.offline_synced,
        prepared_by: ctx.userId,
        prepared_at: allChecklistComplete ? new Date() : null,
      },
      update: {
        checklist: normalizedChecklist,
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
