import type { NextRequest } from 'next/server';
import { deriveFacilityLabel, deriveVisitPlaceGroup } from '@/lib/utils/facility';
import { facilityPacketMemoToDisplayText } from '@/lib/visits/facility-packet';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { forbiddenResponse, notFound, success, validationError } from '@/lib/api/response';
import { hasPermission } from '@/lib/auth/permissions';
import { describeOperationalTask } from '@/server/services/operational-tasks';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import { buildVisitReadyReadinessBlockers } from '@/server/services/visit-preparation-readiness';
import {
  getPatientHomeCareFeatureSummary,
  selectScheduleHomeCareFeatureHighlights,
} from '@/server/services/home-care-ops';
import { getScheduleVisitBrief } from '@/server/services/visit-brief';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import {
  deriveOutsideMedEvidenceKind,
  OUTSIDE_MED_EVIDENCE_KIND_LABELS,
} from '@/lib/dispensing/outside-med-classification';
import { type OutsideMedEvidenceKind } from '@/lib/dispensing/set-audit-constants';
import {
  BILLING_COLLECTION_TIMING_LABELS,
  BILLING_DOCUMENT_ISSUE_STATUS_LABELS,
  BILLING_PAYMENT_METHOD_LABELS,
  BILLING_PAYMENT_PROFILE_TASK_TYPE,
  BILLING_RECEIPT_ISSUE_LABELS,
  buildConferenceHighlights,
  buildPreviousStructuredVisitReuse,
  buildPreviousVisitSummary,
  countPreparationBlockers,
  estimateBillingCandidateAmount,
  isVisitPreparationConferenceNoteType,
  parseConferenceActionItems,
  parseConferenceParticipants,
  parseConferenceSections,
  parseConferenceSyncSummary,
  readBillingCollection,
  readConferenceSectionBody,
  readString,
  resolveCollectionOutstandingAmount,
  summarizePrescriptionChanges,
  toDateString,
  type FacilityParallelSchedule,
} from './route.get-helpers';

async function authenticatedVisitPreparationGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
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
      carry_items_status: true,
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

  const [
    billingEvidence,
    billingCandidates,
    billingPaymentProfileTask,
    recentPrescriptionIntakes,
    firstVisitDoc,
    recentConferenceNotes,
    previousVisit,
    openTasks,
    recentContactLogs,
    sameDaySchedules,
  ] = await Promise.all([
    listBillingEvidenceBlockers(prisma, {
      orgId: ctx.orgId,
      patientId: schedule.case_.patient.id,
      visitRecordIds: scopedVisitRecordIds,
      cycleIds: scopedCycleIds,
      limit: 4,
    }),
    prisma.billingCandidate.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: schedule.case_.patient.id,
        ...(scopedCycleIds.length === 0
          ? { id: { in: [] } }
          : { cycle_id: { in: scopedCycleIds } }),
        status: {
          not: 'excluded',
        },
      },
      orderBy: [{ billing_month: 'desc' }, { updated_at: 'desc' }],
      select: {
        id: true,
        billing_month: true,
        billing_name: true,
        points: true,
        status: true,
        calculation_breakdown: true,
        updated_at: true,
      },
    }),
    prisma.task.findFirst({
      where: {
        org_id: ctx.orgId,
        task_type: BILLING_PAYMENT_PROFILE_TASK_TYPE,
        related_entity_type: 'patient',
        related_entity_id: schedule.case_.patient.id,
      },
      orderBy: [{ updated_at: 'desc' }],
      select: {
        metadata: true,
      },
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
            id: true,
            drug_name: true,
            drug_master_id: true,
            drug_code: true,
            dose: true,
            frequency: true,
            days: true,
            start_date: true,
            end_date: true,
            // その他薬分類(§11-7)の導出に必要なフィールドを追加 select する。
            route: true,
            dosage_form: true,
            unit: true,
            packaging_instructions: true,
            packaging_instruction_tags: true,
            notes: true,
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
    prisma.visitRecord.findFirst({
      where: {
        org_id: ctx.orgId,
        schedule: {
          case_id: schedule.case_id,
        },
        visit_date: {
          lt: schedule.scheduled_date,
        },
        schedule_id: {
          not: schedule.id,
        },
      },
      orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        visit_date: true,
        outcome_status: true,
        soap_plan: true,
        structured_soap: true,
        next_visit_suggestion_date: true,
        version: true,
        updated_at: true,
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
        outcome: true,
        contact_method: true,
        note: true,
        callback_due_at: true,
        called_at: true,
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

  const readinessBlockers = buildVisitReadyReadinessBlockers(
    preparation,
    schedule.carry_items_status,
  );
  const homeCareFeatureSummary = await getPatientHomeCareFeatureSummary(prisma, {
    orgId: ctx.orgId,
    patientId: schedule.case_.patient.id,
  });
  const visitBrief = await getScheduleVisitBrief(prisma, {
    orgId: ctx.orgId,
    patientId: schedule.case_.patient.id,
    caseIds: [schedule.case_id],
    currentScheduleId: schedule.id,
    scheduledDate: schedule.scheduled_date,
    billingContext: {
      visitRecordIds: scopedVisitRecordIds,
      cycleIds: scopedCycleIds,
      blockers: billingEvidence,
    },
  });
  const latestIntake = recentPrescriptionIntakes[0] ?? null;
  const previousIntake = recentPrescriptionIntakes[1] ?? null;

  // その他薬(セット外で持ち出す薬: 外用/頓服/注射/液剤/冷所)の分類を最新処方明細から導出し、
  // 訪問準備 UI が同一語彙で表示できるよう server projection する(§11-7)。
  // FE 側で部分フィールドから再導出させない(outside_med_kind/label を消費)。
  const outsideMeds = (latestIntake?.lines ?? [])
    .map((line) => {
      const kind = deriveOutsideMedEvidenceKind(line);
      return kind
        ? {
            line_id: line.id,
            drug_name: line.drug_name,
            outside_med_kind: kind,
            outside_med_label: OUTSIDE_MED_EVIDENCE_KIND_LABELS[kind],
          }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        line_id: string;
        drug_name: string;
        outside_med_kind: OutsideMedEvidenceKind;
        outside_med_label: string;
      } => item !== null,
    );
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
            added_medications: latestIntake.lines.map((line) => ({
              drug_name: line.drug_name,
              drug_code: line.drug_code,
            })),
            changed: [],
            removed: [],
            removed_medications: [],
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
  const billingPaymentProfile = readJsonObject(billingPaymentProfileTask?.metadata);
  const canViewBillingDetails = hasPermission(ctx.role, 'canManageBilling');
  const billingCandidateCollections = billingCandidates.map((candidate) => {
    const collection = readBillingCollection(candidate.calculation_breakdown);
    const estimatedAmount = estimateBillingCandidateAmount(candidate);
    return {
      candidate,
      collection,
      estimatedAmount,
      outstandingAmount: resolveCollectionOutstandingAmount(collection, estimatedAmount),
    };
  });
  const currentBillingMonth = billingCandidateCollections[0]?.candidate.billing_month ?? null;
  const currentBillingRows = currentBillingMonth
    ? billingCandidateCollections.filter(
        (item) => item.candidate.billing_month.getTime() === currentBillingMonth.getTime(),
      )
    : [];
  const previousBillingRows = currentBillingMonth
    ? billingCandidateCollections.filter(
        (item) => item.candidate.billing_month.getTime() < currentBillingMonth.getTime(),
      )
    : [];
  const latestBilling = currentBillingRows[0] ?? null;
  const previousUnpaidAmount = previousBillingRows.reduce(
    (sum, item) => sum + Math.max(item.outstandingAmount ?? 0, 0),
    0,
  );
  const currentCollectionAmount = currentBillingRows.length
    ? currentBillingRows.reduce((sum, item) => sum + Math.max(item.outstandingAmount ?? 0, 0), 0)
    : null;
  const currentBilledAmount = currentBillingRows.length
    ? currentBillingRows.reduce((sum, item) => {
        const billedAmount = item.collection?.billed_amount ?? item.estimatedAmount ?? 0;
        return sum + Math.max(billedAmount, 0);
      }, 0)
    : null;
  const totalCollectionAmount =
    latestBilling || previousUnpaidAmount > 0
      ? (currentCollectionAmount ?? 0) + previousUnpaidAmount
      : null;
  const latestCollection = latestBilling?.collection ?? null;
  const fallbackPaymentMethod = readString(billingPaymentProfile?.payment_method);
  const collectionTiming = readString(billingPaymentProfile?.collection_timing);
  const collectionMethod =
    latestCollection?.payment_method ??
    fallbackPaymentMethod ??
    readString(intakeData?.collection_method) ??
    null;
  const receiptIssue = readString(billingPaymentProfile?.receipt_issue);
  const billingCollectionContext =
    latestBilling || billingPaymentProfile
      ? {
          candidate_id: latestBilling?.candidate.id ?? null,
          billing_month: latestBilling?.candidate.billing_month.toISOString() ?? null,
          billing_name: latestBilling?.candidate.billing_name ?? null,
          candidate_status: latestBilling?.candidate.status ?? null,
          current_billed_amount: currentBilledAmount,
          current_collection_amount: currentCollectionAmount,
          previous_unpaid_amount: previousUnpaidAmount,
          total_collection_amount: totalCollectionAmount,
          collected_amount: latestCollection?.collected_amount ?? null,
          payer_name: canViewBillingDetails
            ? (latestCollection?.payer_name ??
              readString(billingPaymentProfile?.payer_name) ??
              null)
            : null,
          payer_relation: canViewBillingDetails
            ? readString(billingPaymentProfile?.payer_relation)
            : null,
          collection_method: collectionMethod,
          collection_method_label: collectionMethod
            ? (BILLING_PAYMENT_METHOD_LABELS[collectionMethod] ?? collectionMethod)
            : null,
          collection_timing: collectionTiming,
          collection_timing_label: collectionTiming
            ? (BILLING_COLLECTION_TIMING_LABELS[collectionTiming] ?? collectionTiming)
            : null,
          scheduled_collection_at: latestCollection?.scheduled_collection_at ?? null,
          collected_at: latestCollection?.collected_at ?? null,
          receipt_issue: receiptIssue,
          receipt_issue_label: receiptIssue
            ? (BILLING_RECEIPT_ISSUE_LABELS[receiptIssue] ?? receiptIssue)
            : null,
          receipt_issue_status: latestCollection?.receipt_issue_status ?? null,
          receipt_issue_status_label: latestCollection?.receipt_issue_status
            ? (BILLING_DOCUMENT_ISSUE_STATUS_LABELS[latestCollection.receipt_issue_status] ??
              latestCollection.receipt_issue_status)
            : null,
          receipt_number: canViewBillingDetails ? (latestCollection?.receipt_number ?? null) : null,
          collector_user_id: canViewBillingDetails ? (latestCollection?.updated_by ?? null) : null,
        }
      : null;
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
          common_notes: facilityPacketMemoToDisplayText(schedule.facility_batch?.notes ?? null),
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
              source_revision: {
                version: previousVisit.version,
                updated_at: previousVisit.updated_at.toISOString(),
              },
              summary: buildPreviousVisitSummary(previousVisit),
              structured_reuse: buildPreviousStructuredVisitReuse(previousVisit),
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
          outcome: log.outcome,
          contact_method: log.contact_method,
          has_note: Boolean(log.note?.trim()),
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
        billing_collection_context: billingCollectionContext,
        prescription_changes: prescriptionChanges,
        outside_meds: outsideMeds,
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

export const GET = withAuthContext(authenticatedVisitPreparationGET, {
  permission: 'canVisit',
  message: '訪問準備情報の閲覧権限がありません',
});
