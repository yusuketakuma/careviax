import { format } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import {
  getPatientPrivacyFlags,
  maskAddressDetail,
  maskContactValue,
  maskInsuranceNumber,
  maskPhoneNumber,
} from '@/lib/patient/privacy';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import {
  CHANNEL_LABELS,
  PRIORITY_LABELS,
  REPORT_STATUS_CONFIG,
  REPORT_TYPE_LABELS,
  SCHEDULE_STATUS_LABELS,
  VISIT_OUTCOME_LABELS,
} from '@/lib/constants/status-labels';
import { getPatientRiskSummary } from '@/server/services/patient-risk';
import { getPatientVisitBrief } from '@/server/services/visit-brief';
import { getPatientHomeCareFeatureSummary } from '@/server/services/home-care-ops';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import {
  findActiveVisitConsent,
  findCurrentManagementPlan,
} from '@/server/services/management-plans';
import {
  buildVisitScheduleCommunicationTargets,
  resolveVisitScheduleCommunicationChannel,
  type VisitScheduleSchedulingPreferenceContext,
} from '@/server/services/visit-schedule-communication';
import {
  getInquiryPresentationBadges,
  getInquiryPrimaryDetail,
} from '@/lib/inquiries/presentation';
import { getConferenceTypeLabel } from '@/lib/visits/visit-workflow-projection';

type DbClient = typeof prisma | Prisma.TransactionClient;

type DetailArgs = {
  orgId: string;
  patientId: string;
  role: string;
};

type FirstVisitDocumentContact = {
  id?: string;
  name: string;
  relation: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  organization_name: string | null;
  department: string | null;
  is_primary: boolean;
  is_emergency_contact: boolean;
};

const PRESCRIPTION_SOURCE_LABELS: Record<string, string> = {
  paper: '紙処方箋',
  fax: 'FAX',
  e_prescription: '電子処方箋',
  facility_batch: '施設一括',
  refill: 'リフィル',
  qr_scan: 'QR取込',
};

const CYCLE_STATUS_LABELS: Record<string, string> = {
  intake_received: '受付済',
  structuring: '構造化中',
  inquiry_pending: '疑義照会中',
  inquiry_resolved: '照会解決',
  ready_to_dispense: '調剤待ち',
  dispensing: '調剤中',
  dispensed: '調剤済',
  audit_pending: '鑑査待ち',
  audited: '鑑査済',
  setting: 'セット中',
  set_audited: 'セット済',
  visit_ready: '訪問準備完了',
  visit_completed: '訪問完了',
  reported: '報告済',
  on_hold: '保留',
  cancelled: '取消',
};

const MANAGEMENT_PLAN_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  approved: '承認済み',
};

const CARRY_TYPE_LABELS: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後送',
};

const VISIT_TYPE_LABELS: Record<string, string> = {
  initial: '初回訪問',
  regular: '定期訪問',
  temporary: '臨時訪問',
  revisit: '再訪問',
  delivery_only: '配薬のみ',
  emergency: '緊急訪問',
  physician_co_visit: '同行訪問',
};

function formatTimelineDate(value: Date | null | undefined) {
  return value ? format(value, 'yyyy/MM/dd') : null;
}

function compactTimelineValues(values: Array<string | null | undefined | false>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function readObjectString(input: unknown, key: string) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function normalizeCareTeamRole(role: string) {
  if (['physician', 'doctor', 'clinic', 'prescriber'].includes(role)) return 'physician';
  if (['nurse', 'visiting_nurse', 'home_nurse'].includes(role)) return 'nurse';
  if (['care_manager', 'caremanager', 'cm'].includes(role)) return 'care_manager';
  return role;
}

function hasJsonArrayItems(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) && value.length > 0;
}

function normalizeFirstVisitDocumentContacts(
  value: Prisma.JsonValue | null | undefined,
): FirstVisitDocumentContact[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : null;
    if (!name) return [];

    return [
      {
        id: typeof record.id === 'string' ? record.id : undefined,
        name,
        relation: typeof record.relation === 'string' ? record.relation : null,
        phone: typeof record.phone === 'string' ? record.phone : null,
        email: typeof record.email === 'string' ? record.email : null,
        fax: typeof record.fax === 'string' ? record.fax : null,
        organization_name:
          typeof record.organization_name === 'string' ? record.organization_name : null,
        department: typeof record.department === 'string' ? record.department : null,
        is_primary: record.is_primary === true,
        is_emergency_contact: record.is_emergency_contact === true,
      },
    ];
  });
}

async function findPatientOverviewBase(db: DbClient, args: DetailArgs) {
  return db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      gender: true,
      phone: true,
      medical_insurance_number: true,
      care_insurance_number: true,
      billing_support_flag: true,
      allergy_info: true,
      notes: true,
      archived_at: true,
      archived_by: true,
      residences: true,
      scheduling_preference: {
        select: {
          preferred_weekdays: true,
          preferred_time_from: true,
          preferred_time_to: true,
          phone_contact_from: true,
          phone_contact_to: true,
          facility_time_from: true,
          facility_time_to: true,
          family_presence_required: true,
          visit_buffer_minutes: true,
          preferred_contact_name: true,
          preferred_contact_phone: true,
          visit_before_contact_required: true,
          first_visit_preferred_date: true,
          first_visit_time_slot: true,
          first_visit_time_note: true,
          parking_available: true,
          primary_contact_preference: true,
          mcs_linked: true,
          adl_level: true,
          dementia_level: true,
          swallowing_route: true,
          care_level: true,
          infection_isolation: true,
        },
      },
      contacts: true,
      conditions: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      },
      consents: true,
      cases: {
        orderBy: { created_at: 'desc' },
        include: {
          care_team_links: true,
        },
      },
    },
  });
}

async function listLabSummary(db: DbClient, args: Pick<DetailArgs, 'orgId' | 'patientId'>) {
  const keyAnalytes = ['egfr', 'scr', 'k', 'crp', 'hba1c', 'pt_inr', 'alb'] as const;
  const labRows = await db.patientLabObservation.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      analyte_code: { in: keyAnalytes as unknown as never[] },
    },
    orderBy: [{ measured_at: 'desc' }],
    take: 50,
    select: {
      analyte_code: true,
      measured_at: true,
      value_numeric: true,
      unit: true,
      abnormal_flag: true,
    },
  });

  const labSummaryMap = new Map<string, (typeof labRows)[number]>();
  for (const row of labRows) {
    if (!labSummaryMap.has(row.analyte_code)) {
      labSummaryMap.set(row.analyte_code, row);
    }
  }

  return Array.from(labSummaryMap.values());
}

function pickPrimaryCareTeamLink<
  T extends {
    role: string;
    name: string;
    phone: string | null;
    email?: string | null;
    fax?: string | null;
    is_primary?: boolean;
    organization_name?: string | null;
  },
>(links: T[], role: string) {
  return (
    [...links]
      .filter((link) => link.role === role)
      .sort(
        (left, right) => Number(Boolean(right.is_primary)) - Number(Boolean(left.is_primary)),
      )[0] ?? null
  );
}

function compactPreviewValues(values: Array<string | null | undefined | false>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

export async function getPatientOverview(db: DbClient, args: DetailArgs) {
  const patient = await findPatientOverviewBase(db, args);
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const [
    visitSchedules,
    openTasksCount,
    riskSummary,
    visitBrief,
    labSummary,
    jahisSupplementalRecords,
    archivedByNameMap,
  ] = await Promise.all([
    caseIds.length === 0
      ? Promise.resolve([])
      : db.visitSchedule.findMany({
          where: {
            org_id: args.orgId,
            case_id: { in: caseIds },
          },
          orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }],
          take: 8,
          select: {
            id: true,
            scheduled_date: true,
            schedule_status: true,
            visit_record: {
              select: {
                id: true,
                outcome_status: true,
              },
            },
          },
        }),
    db.task.count({
      where: {
        org_id: args.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        OR: [
          {
            related_entity_type: 'patient',
            related_entity_id: args.patientId,
          },
          ...(caseIds.length > 0
            ? [
                {
                  related_entity_type: 'case',
                  related_entity_id: {
                    in: caseIds,
                  },
                },
              ]
            : []),
        ],
      },
    }),
    getPatientRiskSummary(db, {
      orgId: args.orgId,
      patientId: args.patientId,
    }),
    getPatientVisitBrief(db, {
      orgId: args.orgId,
      patientId: args.patientId,
      context: 'patient',
    }),
    listLabSummary(db, args),
    db.jahisSupplementalRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: [{ created_at: 'desc' }, { line_number: 'asc' }],
      take: 8,
      select: {
        id: true,
        record_type: true,
        record_label: true,
        line_number: true,
        summary: true,
        payload: true,
        raw_line: true,
      },
    }),
    batchResolveNames(
      db as typeof prisma,
      args.orgId,
      patient.archived_by ? [patient.archived_by] : [],
    ),
  ]);

  const privacy = getPatientPrivacyFlags(args.role);

  return {
    ...patient,
    archived_by_name: patient.archived_by
      ? (archivedByNameMap.get(patient.archived_by) ?? null)
      : null,
    phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(patient.phone) : patient.phone,
    medical_insurance_number: privacy.sensitiveFieldsMasked
      ? maskInsuranceNumber(patient.medical_insurance_number)
      : patient.medical_insurance_number,
    care_insurance_number: privacy.sensitiveFieldsMasked
      ? maskInsuranceNumber(patient.care_insurance_number)
      : patient.care_insurance_number,
    residences: patient.residences.map((residence) => ({
      ...residence,
      address: privacy.addressFieldsMasked
        ? maskAddressDetail(residence.address)
        : residence.address,
    })),
    conditions: patient.conditions,
    cases: patient.cases,
    visit_schedules: visitSchedules,
    summary_metrics: {
      open_tasks_count: openTasksCount,
    },
    risk_summary: riskSummary,
    visit_brief: visitBrief,
    lab_summary: labSummary,
    jahis_supplemental_records: jahisSupplementalRecords,
    privacy: {
      sensitive_fields_masked: privacy.sensitiveFieldsMasked,
      address_fields_masked: privacy.addressFieldsMasked,
      can_view_detail: privacy.canViewDetail,
    },
  };
}

export async function getPatientVisitsData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: {
      id: true,
      cases: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const currentMonthStart = new Date();
  currentMonthStart.setHours(0, 0, 0, 0);
  currentMonthStart.setDate(1);
  const nextMonthStart = new Date(currentMonthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);

  const [visitSchedules, currentMonthVisitCount, visitRecords, homeCareFeatureSummary] =
    await Promise.all([
      caseIds.length === 0
        ? Promise.resolve([])
        : db.visitSchedule.findMany({
            where: {
              org_id: args.orgId,
              case_id: { in: caseIds },
            },
            orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }],
            take: 12,
            select: {
              id: true,
              scheduled_date: true,
              schedule_status: true,
              priority: true,
              confirmed_at: true,
              route_order: true,
              visit_record: {
                select: {
                  id: true,
                  outcome_status: true,
                },
              },
            },
          }),
      caseIds.length === 0
        ? Promise.resolve(0)
        : db.visitSchedule.count({
            where: {
              org_id: args.orgId,
              case_id: { in: caseIds },
              scheduled_date: {
                gte: currentMonthStart,
                lt: nextMonthStart,
              },
            },
          }),
      caseIds.length === 0
        ? Promise.resolve([])
        : db.visitRecord.findMany({
            where: {
              org_id: args.orgId,
              patient_id: args.patientId,
            },
            orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
            take: 12,
            select: {
              id: true,
              schedule_id: true,
              visit_date: true,
              outcome_status: true,
              next_visit_suggestion_date: true,
              cancellation_reason: true,
              postpone_reason: true,
              revisit_reason: true,
              created_at: true,
            },
          }),
      getPatientHomeCareFeatureSummary(db, {
        orgId: args.orgId,
        patientId: args.patientId,
      }),
    ]);

  return {
    monthly_visit_count: currentMonthVisitCount,
    visit_schedules: visitSchedules,
    visit_records: visitRecords,
    home_care_feature_summary: homeCareFeatureSummary,
  };
}

export async function getPatientCommunicationsData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: {
      id: true,
      cases: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const [
    openTasks,
    medicationIssues,
    billingEvidence,
    billingEvidenceBlockers,
    billingCandidates,
    communicationQueue,
  ] = await Promise.all([
    db.task.findMany({
      where: {
        org_id: args.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        OR: [
          {
            related_entity_type: 'patient',
            related_entity_id: args.patientId,
          },
          ...(caseIds.length > 0
            ? [
                {
                  related_entity_type: 'case',
                  related_entity_id: {
                    in: caseIds,
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: 8,
      select: {
        id: true,
        task_type: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        due_date: true,
        sla_due_at: true,
        created_at: true,
      },
    }),
    db.medicationIssue.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        status: {
          in: ['open', 'in_progress'],
        },
      },
      orderBy: [{ priority: 'desc' }, { identified_at: 'desc' }],
      take: 6,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        category: true,
        identified_at: true,
      },
    }),
    db.billingEvidence.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }],
      take: 6,
      select: {
        id: true,
        billing_month: true,
        claimable: true,
        exclusion_reason: true,
        validation_notes: true,
        calculation_context: true,
      },
    }),
    listBillingEvidenceBlockers(db as typeof prisma, {
      orgId: args.orgId,
      patientId: args.patientId,
      limit: 6,
    }),
    db.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }],
      take: 6,
      select: {
        id: true,
        billing_month: true,
        billing_code: true,
        billing_name: true,
        points: true,
        status: true,
        exclusion_reason: true,
        source_snapshot: true,
      },
    }),
    listCommunicationQueue(db as typeof prisma, {
      orgId: args.orgId,
      patientId: args.patientId,
      limit: 6,
    }),
  ]);

  return {
    communication_queue: communicationQueue,
    open_tasks: openTasks,
    medication_issues: medicationIssues,
    billing_summary: {
      evidence: billingEvidence.map((item) => ({
        ...item,
        effective_revision_code: readObjectString(
          item.calculation_context,
          'effective_revision_code',
        ),
        site_config_status: readObjectString(item.calculation_context, 'site_config_status'),
        blockers: billingEvidenceBlockers.find((blocker) => blocker.id === item.id)?.blockers ?? [],
      })),
      candidates: billingCandidates.map((item) => ({
        ...item,
        effective_revision_code: readObjectString(item.source_snapshot, 'revision_code'),
        site_config_status: readObjectString(item.source_snapshot, 'site_config_status'),
      })),
      claimable_count: billingEvidence.filter((item) => item.claimable).length,
      blocked_count: billingEvidence.filter((item) => !item.claimable).length,
    },
  };
}

export async function getPatientDocumentsData(db: DbClient, args: DetailArgs) {
  const patient = await findPatientOverviewBase(db, args);
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const firstVisitDocuments =
    caseIds.length === 0
      ? []
      : await db.firstVisitDocument.findMany({
          where: {
            org_id: args.orgId,
            patient_id: args.patientId,
            case_id: { in: caseIds },
          },
          orderBy: [{ created_at: 'desc' }],
          select: {
            id: true,
            case_id: true,
            emergency_contacts: true,
            document_url: true,
            delivered_at: true,
            delivered_to: true,
            created_at: true,
            updated_at: true,
          },
        });

  const privacy = getPatientPrivacyFlags(args.role);

  return {
    first_visit_documents: firstVisitDocuments.map((item) => ({
      ...item,
      emergency_contacts: normalizeFirstVisitDocumentContacts(item.emergency_contacts).map(
        (contact) => ({
          ...contact,
          phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.phone) : contact.phone,
          fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
          email: privacy.sensitiveFieldsMasked ? maskContactValue(contact.email) : contact.email,
        }),
      ),
    })),
  };
}

export async function getPatientTimelineData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: {
      id: true,
      cases: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);

  const [
    visitSchedules,
    visitRecords,
    careReports,
    communicationEvents,
    selfReports,
    externalShares,
    inquiryRecords,
    prescriptionIntakes,
    dispenseResults,
    managementPlans,
    firstVisitDocuments,
    conferenceNotes,
    billingCandidates,
  ] = await Promise.all([
    caseIds.length === 0
      ? Promise.resolve([])
      : db.visitSchedule.findMany({
          where: {
            org_id: args.orgId,
            case_id: { in: caseIds },
          },
          orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }],
          take: 12,
          select: {
            id: true,
            visit_type: true,
            scheduled_date: true,
            schedule_status: true,
            priority: true,
            pharmacist_id: true,
            confirmed_at: true,
            route_order: true,
            created_at: true,
            updated_at: true,
            visit_record: {
              select: {
                id: true,
                outcome_status: true,
              },
            },
          },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.visitRecord.findMany({
          where: {
            org_id: args.orgId,
            patient_id: args.patientId,
          },
          orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
          take: 12,
          select: {
            id: true,
            schedule_id: true,
            pharmacist_id: true,
            visit_date: true,
            outcome_status: true,
            next_visit_suggestion_date: true,
            cancellation_reason: true,
            postpone_reason: true,
            revisit_reason: true,
            created_at: true,
          },
        }),
    db.careReport.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        report_type: true,
        status: true,
        created_by: true,
        created_at: true,
        delivery_records: {
          orderBy: [{ created_at: 'desc' }],
          take: 4,
          select: {
            id: true,
            channel: true,
            recipient_name: true,
            status: true,
            sent_at: true,
            confirmed_at: true,
            created_at: true,
          },
        },
      },
    }),
    db.communicationEvent.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: [{ occurred_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        event_type: true,
        channel: true,
        direction: true,
        subject: true,
        counterpart_name: true,
        occurred_at: true,
      },
    }),
    db.patientSelfReport.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        subject: true,
        category: true,
        content: true,
        relation: true,
        status: true,
        reported_by_name: true,
        requested_callback: true,
        preferred_contact_time: true,
        created_at: true,
      },
    }),
    db.externalAccessGrant.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        revoked_at: null,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        granted_to_name: true,
        expires_at: true,
        accessed_at: true,
        created_at: true,
      },
    }),
    db.inquiryRecord.findMany({
      where: {
        org_id: args.orgId,
        cycle: {
          patient_id: args.patientId,
        },
      },
      orderBy: [{ resolved_at: 'desc' }, { inquired_at: 'desc' }, { created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        reason: true,
        inquiry_to_physician: true,
        inquiry_content: true,
        result: true,
        proposal_origin: true,
        residual_adjustment: true,
        change_detail: true,
        inquired_at: true,
        resolved_at: true,
        created_at: true,
        line: {
          select: {
            intake: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
    db.prescriptionIntake.findMany({
      where: {
        org_id: args.orgId,
        cycle: {
          patient_id: args.patientId,
        },
      },
      orderBy: [{ created_at: 'desc' }],
      take: 10,
      select: {
        id: true,
        source_type: true,
        prescribed_date: true,
        prescriber_name: true,
        prescriber_institution: true,
        original_collected_by: true,
        created_at: true,
        cycle: {
          select: {
            overall_status: true,
          },
        },
        lines: {
          take: 3,
          select: {
            id: true,
          },
        },
      },
    }),
    db.dispenseResult.findMany({
      where: {
        org_id: args.orgId,
        line: {
          intake: {
            cycle: {
              patient_id: args.patientId,
            },
          },
        },
      },
      orderBy: [{ dispensed_at: 'desc' }],
      take: 12,
      select: {
        id: true,
        actual_drug_name: true,
        actual_quantity: true,
        actual_unit: true,
        carry_type: true,
        dispensed_by: true,
        dispensed_at: true,
        task: {
          select: {
            cycle: {
              select: {
                overall_status: true,
              },
            },
          },
        },
        line: {
          select: {
            intake: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.managementPlan.findMany({
          where: {
            org_id: args.orgId,
            case_id: {
              in: caseIds,
            },
          },
          orderBy: [{ updated_at: 'desc' }],
          take: 6,
          select: {
            id: true,
            status: true,
            title: true,
            effective_from: true,
            next_review_date: true,
            created_by: true,
            approved_by: true,
            approved_at: true,
            reviewed_by: true,
            reviewed_at: true,
            created_at: true,
          },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.firstVisitDocument.findMany({
          where: {
            org_id: args.orgId,
            patient_id: args.patientId,
            case_id: { in: caseIds },
          },
          orderBy: [{ created_at: 'desc' }],
          select: {
            id: true,
            document_url: true,
            delivered_at: true,
            delivered_to: true,
            created_at: true,
          },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.conferenceNote.findMany({
          where: {
            org_id: args.orgId,
            OR: [{ patient_id: args.patientId }, { case_id: { in: caseIds } }],
            note_type: { in: ['pre_discharge', 'service_manager'] },
          },
          orderBy: [{ conference_date: 'desc' }],
          take: 8,
          select: {
            id: true,
            note_type: true,
            title: true,
            conference_date: true,
            follow_up_date: true,
            follow_up_completed: true,
            generated_report_id: true,
            action_items: true,
          },
        }),
    db.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        billing_month: true,
        billing_code: true,
        billing_name: true,
        points: true,
        status: true,
        exclusion_reason: true,
        updated_at: true,
      },
    }),
  ]);

  const actorNameMap = await batchResolveNames(
    prisma,
    args.orgId,
    Array.from(
      new Set(
        compactTimelineValues([
          ...visitSchedules.map((item) => item.pharmacist_id),
          ...visitRecords.map((item) => item.pharmacist_id),
          ...careReports.map((item) => item.created_by),
          ...dispenseResults.map((item) => item.dispensed_by),
          ...managementPlans.flatMap((item) => [
            item.created_by,
            item.approved_by,
            item.reviewed_by,
          ]),
        ]),
      ),
    ),
  );

  const timelineEvents = [
    ...visitSchedules.map((item) => ({
      id: `visit_schedule:${item.id}`,
      event_type: 'visit_schedule' as const,
      category: 'visit' as const,
      occurred_at: item.confirmed_at ?? item.updated_at ?? item.created_at,
      title: item.confirmed_at ? '訪問予定を確定' : '訪問予定を登録',
      summary:
        compactTimelineValues([
          VISIT_TYPE_LABELS[item.visit_type] ?? item.visit_type,
          formatTimelineDate(item.scheduled_date)
            ? `訪問日 ${formatTimelineDate(item.scheduled_date)}`
            : null,
          item.visit_record ? '訪問記録あり' : null,
        ]).join(' / ') || null,
      href: item.visit_record ? `/visits/${item.visit_record.id}` : `/visits/${item.id}/record`,
      action_label: item.visit_record ? '訪問記録を開く' : '訪問記録を入力',
      status: item.schedule_status,
      status_label: SCHEDULE_STATUS_LABELS[item.schedule_status] ?? item.schedule_status,
      actor_name: actorNameMap.get(item.pharmacist_id) ?? null,
      metadata: compactTimelineValues([
        item.priority ? `優先度 ${PRIORITY_LABELS[item.priority] ?? item.priority}` : null,
        item.route_order ? `ルート順 ${item.route_order}` : null,
      ]),
    })),
    ...visitRecords.map((item) => ({
      id: `visit_record:${item.id}`,
      event_type: 'visit_record' as const,
      category: 'visit' as const,
      occurred_at: item.visit_date ?? item.created_at,
      title: '訪問記録を登録',
      summary:
        compactTimelineValues([
          item.revisit_reason,
          item.postpone_reason,
          item.cancellation_reason,
        ]).join(' / ') || null,
      href: `/visits/${item.id}`,
      action_label: '訪問記録を開く',
      status: item.outcome_status,
      status_label: VISIT_OUTCOME_LABELS[item.outcome_status] ?? item.outcome_status,
      actor_name: actorNameMap.get(item.pharmacist_id) ?? null,
      metadata: compactTimelineValues([
        item.next_visit_suggestion_date
          ? `次回提案 ${formatTimelineDate(item.next_visit_suggestion_date)}`
          : null,
      ]),
    })),
    ...prescriptionIntakes.map((item) => ({
      id: `prescription_intake:${item.id}`,
      event_type: 'prescription_intake' as const,
      category: 'prescription' as const,
      occurred_at: item.created_at,
      title: '処方受付を登録',
      summary:
        compactTimelineValues([
          PRESCRIPTION_SOURCE_LABELS[item.source_type] ?? item.source_type,
          item.prescriber_name ?? item.prescriber_institution,
          formatTimelineDate(item.prescribed_date)
            ? `処方日 ${formatTimelineDate(item.prescribed_date)}`
            : null,
        ]).join(' / ') || null,
      href: `/prescriptions/${item.id}`,
      action_label: '処方受付を開く',
      status: item.cycle.overall_status,
      status_label: CYCLE_STATUS_LABELS[item.cycle.overall_status] ?? item.cycle.overall_status,
      actor_name: item.original_collected_by ?? null,
      metadata: compactTimelineValues([
        item.lines.length > 0 ? `${item.lines.length}剤まで表示` : null,
      ]),
    })),
    ...dispenseResults.map((item) => ({
      id: `dispense_result:${item.id}`,
      event_type: 'dispense_result' as const,
      category: 'prescription' as const,
      occurred_at: item.dispensed_at,
      title: '調剤を記録',
      summary:
        compactTimelineValues([
          item.actual_drug_name,
          `${item.actual_quantity}${item.actual_unit ?? ''}`,
          CARRY_TYPE_LABELS[item.carry_type] ?? item.carry_type,
        ]).join(' / ') || null,
      href: `/prescriptions/${item.line.intake.id}`,
      action_label: '調剤詳細を開く',
      status: item.task.cycle?.overall_status ?? 'dispensed',
      status_label: CYCLE_STATUS_LABELS[item.task.cycle?.overall_status ?? 'dispensed'] ?? '調剤済',
      actor_name: actorNameMap.get(item.dispensed_by) ?? null,
      metadata: [],
    })),
    ...inquiryRecords.map((item) => {
      const inquiryStatus =
        item.result === 'changed'
          ? '変更あり'
          : item.result === 'unchanged'
            ? '変更なし'
            : '回答待ち';

      return {
        id: `inquiry:${item.id}`,
        event_type: 'inquiry' as const,
        category: 'prescription' as const,
        occurred_at: item.resolved_at ?? item.inquired_at ?? item.created_at,
        title: `疑義照会 ${inquiryStatus}`,
        summary:
          compactTimelineValues([
            item.reason,
            item.inquiry_to_physician,
            getInquiryPrimaryDetail({
              inquiryContent: item.inquiry_content,
              changeDetail: item.change_detail,
            }),
          ]).join(' / ') || null,
        href: item.line?.intake?.id ? `/prescriptions/${item.line.intake.id}` : '/workflow',
        action_label: item.line?.intake?.id ? '処方受付を開く' : 'ワークフローを開く',
        status: item.result ?? 'pending',
        status_label: inquiryStatus,
        actor_name: null,
        metadata: compactTimelineValues([
          item.inquired_at ? `照会 ${formatTimelineDate(item.inquired_at)}` : null,
          ...getInquiryPresentationBadges({
            proposalOrigin:
              item.proposal_origin === 'pre_issuance' ? 'pre_issuance' : 'post_inquiry',
            residualAdjustment: item.residual_adjustment,
          }),
        ]),
      };
    }),
    ...careReports.flatMap((item) => [
      {
        id: `care_report:${item.id}`,
        event_type: 'care_report' as const,
        category: 'document' as const,
        occurred_at: item.created_at,
        title: '報告書を作成',
        summary:
          compactTimelineValues([
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
            REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
          ]).join(' / ') || null,
        href: `/reports/${item.id}`,
        action_label: '報告書を開く',
        status: item.status,
        status_label: REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
        actor_name: actorNameMap.get(item.created_by) ?? null,
        metadata: [],
      },
      ...item.delivery_records.map((delivery) => ({
        id: `delivery_record:${delivery.id}`,
        event_type: 'delivery_record' as const,
        category: 'document' as const,
        occurred_at: delivery.confirmed_at ?? delivery.sent_at ?? delivery.created_at,
        title: delivery.status === 'confirmed' ? '報告書の受領を確認' : '報告書を送付',
        summary:
          compactTimelineValues([
            delivery.recipient_name,
            CHANNEL_LABELS[delivery.channel] ?? delivery.channel,
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
          ]).join(' / ') || null,
        href: `/reports/${item.id}`,
        action_label: '送付元報告書を開く',
        status: delivery.status,
        status_label: REPORT_STATUS_CONFIG[delivery.status]?.label ?? delivery.status,
        actor_name: actorNameMap.get(item.created_by) ?? null,
        metadata: [],
      })),
    ]),
    ...managementPlans.map((item) => {
      const actorId = item.approved_by ?? item.reviewed_by ?? item.created_by;
      const occurredAt = item.approved_at ?? item.reviewed_at ?? item.created_at;

      return {
        id: `management_plan:${item.id}`,
        event_type: 'management_plan' as const,
        category: 'document' as const,
        occurred_at: occurredAt,
        title: item.approved_at ? '管理計画書を承認' : '管理計画書を作成',
        summary:
          compactTimelineValues([
            item.title,
            item.effective_from ? `適用開始 ${formatTimelineDate(item.effective_from)}` : null,
            item.next_review_date
              ? `次回見直し ${formatTimelineDate(item.next_review_date)}`
              : null,
          ]).join(' / ') || null,
        href: `/patients/${args.patientId}/management-plan`,
        action_label: '計画書を開く',
        status: item.status,
        status_label: MANAGEMENT_PLAN_STATUS_LABELS[item.status] ?? item.status,
        actor_name: actorNameMap.get(actorId) ?? null,
        metadata: [],
      };
    }),
    ...firstVisitDocuments.map((item) => {
      const isDelivered = Boolean(item.delivered_at);
      return {
        id: `first_visit_document:${item.id}`,
        event_type: 'first_visit_document' as const,
        category: 'document' as const,
        occurred_at: item.delivered_at ?? item.created_at,
        title: isDelivered ? '初回訪問文書を交付' : '初回訪問文書を作成',
        summary:
          compactTimelineValues([
            item.delivered_to,
            isDelivered ? '交付記録あり' : '交付未記録',
          ]).join(' / ') || null,
        href: item.document_url ?? `/patients/${args.patientId}`,
        action_label: item.document_url ? 'PDFを見る' : '患者詳細を開く',
        status: isDelivered ? 'delivered' : 'created',
        status_label: isDelivered ? '交付済み' : '作成済み',
        actor_name: null,
        metadata: [],
      };
    }),
    ...conferenceNotes.map((item) => {
      const actionItemCount = Array.isArray(item.action_items) ? item.action_items.length : 0;
      return {
        id: `conference_note:${item.id}`,
        event_type: 'conference_note' as const,
        category: 'communication' as const,
        occurred_at: item.conference_date,
        title: `${getConferenceTypeLabel(item.note_type)}を記録`,
        summary:
          compactTimelineValues([
            item.title,
            actionItemCount > 0 ? `合意事項 ${actionItemCount}件` : null,
            item.generated_report_id ? '報告ドラフトあり' : null,
          ]).join(' / ') || null,
        href: `/conferences?patient_id=${args.patientId}`,
        action_label: '会議を開く',
        status: item.follow_up_completed ? 'completed' : 'open',
        status_label: item.follow_up_completed ? 'フォロー完了' : 'フォロー中',
        actor_name: null,
        metadata: compactTimelineValues([
          item.follow_up_date ? `フォロー期限 ${formatTimelineDate(item.follow_up_date)}` : null,
        ]),
      };
    }),
    ...billingCandidates.map((item) => ({
      id: `billing_candidate:${item.id}`,
      event_type: 'billing_candidate' as const,
      category: 'document' as const,
      occurred_at: item.updated_at,
      title: '算定候補を更新',
      summary:
        compactTimelineValues([
          item.billing_name,
          item.points != null ? `${item.points}点` : null,
          item.exclusion_reason,
        ]).join(' / ') || null,
      href: `/billing/candidates?${new URLSearchParams({
        billing_month: format(item.billing_month, 'yyyy-MM-01'),
        patient_id: args.patientId,
      }).toString()}`,
      action_label: '算定候補を開く',
      status: item.status,
      status_label:
        item.status === 'candidate'
          ? '候補'
          : item.status === 'confirmed'
            ? '確定'
            : item.status === 'excluded'
              ? '除外'
              : item.status === 'exported'
                ? '締め済み'
                : item.status,
      actor_name: null,
      metadata: compactTimelineValues([
        item.billing_code,
        `算定月 ${formatTimelineDate(item.billing_month)}`,
      ]),
    })),
    ...communicationEvents
      .filter((item) => item.direction !== 'incoming')
      .map((item) => ({
        id: `communication:${item.id}`,
        event_type: 'communication' as const,
        category: 'communication' as const,
        occurred_at: item.occurred_at,
        title: '連絡を記録',
        summary:
          compactTimelineValues([
            CHANNEL_LABELS[item.channel] ?? item.channel,
            item.counterpart_name,
            item.subject ?? item.event_type,
          ]).join(' / ') || null,
        href: `/conferences?patient_id=${args.patientId}`,
        action_label: '連絡履歴を開く',
        status: item.direction,
        status_label: '発信',
        actor_name: null,
        metadata: [],
      })),
    ...externalShares.map((item) => ({
      id: `external_share:${item.id}`,
      event_type: 'external_share' as const,
      category: 'communication' as const,
      occurred_at: item.created_at,
      title: '外部共有リンクを発行',
      summary:
        compactTimelineValues([
          item.granted_to_name,
          item.accessed_at ? '閲覧済み' : '未閲覧',
        ]).join(' / ') || null,
      href: `/patients/${args.patientId}/share`,
      action_label: '共有設定を開く',
      status: item.accessed_at ? 'accessed' : 'issued',
      status_label: item.accessed_at ? '閲覧済み' : '共有中',
      actor_name: null,
      metadata: compactTimelineValues([`期限 ${formatTimelineDate(item.expires_at)}`]),
    })),
  ]
    .sort((left, right) => right.occurred_at.getTime() - left.occurred_at.getTime())
    .slice(0, 40);

  return {
    timeline_events: timelineEvents,
    self_reports: selfReports,
  };
}

export async function getPatientReadinessData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      gender: true,
      phone: true,
      medical_insurance_number: true,
      care_insurance_number: true,
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
      scheduling_preference: {
        select: {
          preferred_weekdays: true,
          preferred_time_from: true,
          preferred_time_to: true,
          facility_time_from: true,
          facility_time_to: true,
          visit_buffer_minutes: true,
          preferred_contact_name: true,
          preferred_contact_phone: true,
          visit_before_contact_required: true,
        },
      },
      insurances: {
        where: { is_active: true },
        select: {
          insurance_type: true,
          insurer_number: true,
          number: true,
          valid_until: true,
        },
      },
      contacts: {
        select: {
          is_emergency_contact: true,
        },
      },
      cases: {
        where: {
          status: { in: ['referral_received', 'assessment', 'active', 'on_hold'] },
        },
        orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
        select: {
          id: true,
          status: true,
          care_team_links: {
            select: {
              role: true,
            },
          },
        },
      },
    },
  });
  if (!patient) return null;

  const currentCase = patient.cases[0] ?? null;
  if (!currentCase) {
    return {
      applicable: false,
      overall_status: 'not_started' as const,
      completed_count: 0,
      total_count: 0,
      current_case: null,
      items: [],
    };
  }

  const [visitConsent, managementPlan, prescriptionIntake, deliveredDocument] = await Promise.all([
    findActiveVisitConsent(db, {
      orgId: args.orgId,
      patientId: args.patientId,
    }),
    findCurrentManagementPlan(db, {
      orgId: args.orgId,
      caseId: currentCase.id,
    }),
    db.prescriptionIntake.findFirst({
      where: {
        org_id: args.orgId,
        cycle: {
          case_id: currentCase.id,
        },
      },
      select: { id: true },
    }),
    db.firstVisitDocument.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        case_id: currentCase.id,
        delivered_at: { not: null },
      },
      select: { id: true },
    }),
  ]);

  const hasEmergencyContact = patient.contacts.some((contact) => contact.is_emergency_contact);
  const careTeamRoles = new Set(
    currentCase.care_team_links.map((link) => normalizeCareTeamRole(link.role)),
  );
  const hasPrimaryPhysician = careTeamRoles.has('physician');
  const hasNurse = careTeamRoles.has('nurse');
  const hasCareManager = careTeamRoles.has('care_manager');
  const primaryResidence = patient.residences[0] ?? null;
  const hasPrimaryResidence = Boolean(
    primaryResidence?.address || primaryResidence?.facility_id || primaryResidence?.building_id,
  );
  const hasInsurance =
    Boolean(patient.medical_insurance_number || patient.care_insurance_number) ||
    patient.insurances.some(
      (insurance) =>
        Boolean(insurance.insurer_number || insurance.number) &&
        (!insurance.valid_until || insurance.valid_until >= new Date()),
    );
  const hasVisitPreferences = Boolean(
    hasJsonArrayItems(patient.scheduling_preference?.preferred_weekdays) ||
    patient.scheduling_preference?.preferred_time_from ||
    patient.scheduling_preference?.preferred_time_to ||
    patient.scheduling_preference?.facility_time_from ||
    patient.scheduling_preference?.facility_time_to ||
    patient.scheduling_preference?.visit_buffer_minutes != null ||
    patient.scheduling_preference?.preferred_contact_name ||
    patient.scheduling_preference?.preferred_contact_phone ||
    patient.scheduling_preference?.visit_before_contact_required != null,
  );

  const items = [
    {
      key: 'patient_profile' as const,
      label: '患者基本情報',
      completed: Boolean(patient.name && patient.name_kana && patient.birth_date && patient.gender),
      description:
        patient.name && patient.name_kana && patient.birth_date && patient.gender
          ? '氏名、カナ、生年月日、性別が登録されています。'
          : '氏名、カナ、生年月日、性別を登録してください。',
      action_href: `/patients/${args.patientId}/edit`,
      action_label: '患者基本を編集',
      severity: 'high' as const,
    },
    {
      key: 'primary_residence' as const,
      label: '訪問先住所・施設',
      completed: hasPrimaryResidence,
      description: hasPrimaryResidence
        ? '訪問先住所、施設、または個人宅グループが登録されています。'
        : '訪問先住所、施設、または個人宅グループを登録してください。',
      action_href: `/patients/${args.patientId}?tab=basic#patient-facility-section`,
      action_label: '訪問先を編集',
      severity: 'high' as const,
    },
    {
      key: 'insurance' as const,
      label: '保険情報',
      completed: hasInsurance,
      description: hasInsurance
        ? '医療保険または介護保険情報が登録されています。'
        : '医療保険または介護保険情報を登録してください。',
      action_href: `/patients/${args.patientId}?tab=basic`,
      action_label: '保険を確認',
      severity: 'high' as const,
    },
    {
      key: 'visit_preferences' as const,
      label: '訪問条件',
      completed: hasVisitPreferences,
      description: hasVisitPreferences
        ? '訪問希望曜日・時間帯・連絡条件のいずれかが登録されています。'
        : '訪問希望曜日、時間帯、連絡条件を登録してください。',
      action_href: `/patients/${args.patientId}?tab=basic#patient-visit-constraints-section`,
      action_label: '訪問条件を編集',
      severity: 'normal' as const,
    },
    {
      key: 'care_team_recipients' as const,
      label: '報告書送付先',
      completed: hasPrimaryPhysician && hasNurse && hasCareManager,
      description:
        hasPrimaryPhysician && hasNurse && hasCareManager
          ? 'クリニック・訪問看護・ケアマネジャーが患者情報に登録されています。'
          : 'クリニック・訪問看護・ケアマネジャーを患者情報のケアチームに登録してください。',
      action_href: `/patients/${args.patientId}?tab=communications`,
      action_label: '連携先を編集',
      severity: 'normal' as const,
    },
    {
      key: 'visit_consent' as const,
      label: '訪問同意',
      completed: Boolean(visitConsent),
      description: visitConsent
        ? '有効な訪問薬剤管理同意があります。'
        : '訪問薬剤管理の有効同意を取得してください。',
      action_href: `/patients/${args.patientId}/consent`,
      action_label: '同意を確認',
      severity: 'high' as const,
    },
    {
      key: 'emergency_contact' as const,
      label: '緊急連絡先',
      completed: hasEmergencyContact,
      description: hasEmergencyContact
        ? '緊急連絡先が登録されています。'
        : '少なくとも1件の緊急連絡先が必要です。',
      action_href: `/patients/${args.patientId}`,
      action_label: '連絡先を編集',
      severity: 'high' as const,
    },
    {
      key: 'primary_physician' as const,
      label: '主治医ケアチーム',
      completed: hasPrimaryPhysician,
      description: hasPrimaryPhysician
        ? '主治医がケアチームに紐付いています。'
        : '現在のケースに主治医を紐付けてください。',
      action_href: `/patients/${args.patientId}`,
      action_label: 'ケアチームを編集',
      severity: 'high' as const,
    },
    {
      key: 'management_plan' as const,
      label: '管理計画書',
      completed: Boolean(managementPlan.current) && !managementPlan.reviewOverdue,
      description: managementPlan.current
        ? managementPlan.reviewOverdue
          ? '承認済みですが見直し期限を超過しています。'
          : '承認済みの管理計画書があります。'
        : '承認済みの管理計画書が必要です。',
      action_href: `/patients/${args.patientId}/management-plan`,
      action_label: '計画書を確認',
      severity: 'high' as const,
    },
    {
      key: 'prescription_intake' as const,
      label: '処方受付',
      completed: Boolean(prescriptionIntake),
      description: prescriptionIntake
        ? 'このケースに紐づく処方受付があります。'
        : '初回訪問までに処方インテークを登録してください。',
      action_href: `/patients/${args.patientId}/prescriptions`,
      action_label: '処方履歴を確認',
      severity: 'normal' as const,
    },
    {
      key: 'first_visit_document' as const,
      label: '初回訪問文書交付',
      completed: Boolean(deliveredDocument),
      description: deliveredDocument
        ? '初回訪問文書の交付記録があります。'
        : '初回訪問文書の交付記録がまだありません。',
      action_href: `/patients/${args.patientId}`,
      action_label: '交付記録を確認',
      severity: 'normal' as const,
    },
  ];

  const completedCount = items.filter((item) => item.completed).length;

  return {
    applicable: true,
    overall_status:
      completedCount === items.length ? ('ready' as const) : ('action_required' as const),
    completed_count: completedCount,
    total_count: items.length,
    current_case: {
      id: currentCase.id,
      status: currentCase.status,
    },
    items,
  };
}

export async function getPatientWorkflowPreviewData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: { id: args.patientId, org_id: args.orgId },
    select: {
      id: true,
      contacts: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        select: {
          id: true,
          name: true,
          relation: true,
          phone: true,
          email: true,
          fax: true,
          is_primary: true,
          is_emergency_contact: true,
        },
      },
      scheduling_preference: {
        select: {
          preferred_weekdays: true,
          preferred_time_from: true,
          preferred_time_to: true,
          phone_contact_from: true,
          phone_contact_to: true,
          facility_time_from: true,
          facility_time_to: true,
          family_presence_required: true,
          visit_buffer_minutes: true,
          preferred_contact_name: true,
          preferred_contact_phone: true,
          visit_before_contact_required: true,
          first_visit_preferred_date: true,
          first_visit_time_slot: true,
          first_visit_time_note: true,
          parking_available: true,
          primary_contact_preference: true,
          mcs_linked: true,
          adl_level: true,
          dementia_level: true,
          swallowing_route: true,
          care_level: true,
          infection_isolation: true,
          notes: true,
        },
      },
      consents: {
        where: {
          consent_type: 'visit_medication_management',
          is_active: true,
          revoked_date: null,
        },
        select: { id: true, expiry_date: true },
      },
      mcs_link: {
        select: {
          id: true,
          source_url: true,
          project_title: true,
          member_count: true,
          last_sync_status: true,
          last_sync_error: true,
        },
      },
      cases: {
        orderBy: [{ updated_at: 'desc' }],
        select: {
          id: true,
          status: true,
          required_visit_support: true,
          care_team_links: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
            select: {
              id: true,
              role: true,
              name: true,
              organization_name: true,
              phone: true,
              email: true,
              fax: true,
              is_primary: true,
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
  if (!patient) return null;

  const currentCase =
    patient.cases.find((item) =>
      ['referral_received', 'assessment', 'active', 'on_hold'].includes(item.status),
    ) ??
    patient.cases[0] ??
    null;
  const intake = currentCase ? getHomeVisitIntake(currentCase.required_visit_support) : null;
  const schedulingPreference = patient.scheduling_preference;
  const careTeamLinks = currentCase?.care_team_links ?? [];

  const physicianCareTeamTarget = pickPrimaryCareTeamLink(careTeamLinks, 'physician');
  const physicianRequesterTarget =
    intake?.requester?.profession === 'physician' && intake.requester.contact_name
      ? {
          role: 'physician',
          name: intake.requester.contact_name,
          organization_name: intake.requester.organization_name ?? null,
          phone: intake.requester.phone ?? null,
          email: null,
          fax: intake.requester.fax ?? null,
          is_primary: false,
        }
      : null;
  const physicianTarget = physicianCareTeamTarget ?? physicianRequesterTarget;
  const careManagerCareTeamTarget = pickPrimaryCareTeamLink(careTeamLinks, 'care_manager');
  const careManagerIntakeTarget = intake?.care_manager?.name
    ? {
        role: 'care_manager',
        name: intake.care_manager.name,
        organization_name: intake.care_manager.organization_name ?? null,
        phone: intake.care_manager.phone ?? null,
        email: null,
        fax: intake.care_manager.fax ?? null,
        is_primary: false,
      }
    : null;
  const careManagerTarget = careManagerCareTeamTarget ?? careManagerIntakeTarget;
  const nurseCareTeamTarget = pickPrimaryCareTeamLink(careTeamLinks, 'nurse');
  const nurseIntakeTarget = intake?.visiting_nurse?.name
    ? {
        role: 'nurse',
        name: intake.visiting_nurse.name,
        organization_name: intake.visiting_nurse.organization_name ?? null,
        phone: intake.visiting_nurse.phone ?? null,
        email: null,
        fax: intake.visiting_nurse.fax ?? null,
        is_primary: false,
      }
    : null;
  const nurseTarget = nurseCareTeamTarget ?? nurseIntakeTarget;

  const communicationPreference: VisitScheduleSchedulingPreferenceContext = {
    preferredContactMethod:
      intake?.requester?.preferred_contact_method ??
      schedulingPreference?.primary_contact_preference ??
      null,
    visitBeforeContactRequired:
      schedulingPreference?.visit_before_contact_required ??
      intake?.visit_before_contact_required ??
      false,
    mcsLinked: schedulingPreference?.mcs_linked ?? intake?.mcs_linked ?? false,
    pharmacyDecisionDueDate: intake?.requester?.pharmacy_decision_due_date
      ? new Date(intake.requester.pharmacy_decision_due_date)
      : null,
  };

  const communicationTargets = buildVisitScheduleCommunicationTargets({
    contacts: patient.contacts.map((contact) => ({
      name: contact.name,
      relation: contact.relation,
      phone: contact.phone,
      email: contact.email,
      fax: contact.fax,
      is_primary: contact.is_primary,
    })),
    careTeamLinks: careTeamLinks.map((link) => ({
      role: link.role,
      name: link.name,
      phone: link.phone,
      email: link.email,
      fax: link.fax,
      is_primary: link.is_primary,
    })),
    channel: 'phone',
    schedulingPreference: communicationPreference,
  });

  const emergencyContacts = patient.contacts.filter((contact) => contact.is_emergency_contact);
  const keyAnalytes = await listLabSummary(db, args);

  return {
    visit_preparation: {
      onboarding_readiness: {
        consent_obtained: patient.consents.length > 0,
        emergency_contact_set: emergencyContacts.length > 0,
        primary_physician_set: Boolean(physicianTarget),
        management_plan_approved: Boolean(currentCase?.management_plans[0]),
      },
      scheduling_preview: {
        preferred_weekdays:
          (schedulingPreference?.preferred_weekdays as number[] | null | undefined) ?? [],
        preferred_time_from: schedulingPreference?.preferred_time_from?.toISOString() ?? null,
        preferred_time_to: schedulingPreference?.preferred_time_to?.toISOString() ?? null,
        phone_contact_from: schedulingPreference?.phone_contact_from?.toISOString() ?? null,
        phone_contact_to: schedulingPreference?.phone_contact_to?.toISOString() ?? null,
        facility_time_from: schedulingPreference?.facility_time_from?.toISOString() ?? null,
        facility_time_to: schedulingPreference?.facility_time_to?.toISOString() ?? null,
        family_presence_required: schedulingPreference?.family_presence_required ?? false,
        visit_buffer_minutes: schedulingPreference?.visit_buffer_minutes ?? null,
        preferred_contact_name: schedulingPreference?.preferred_contact_name ?? null,
        preferred_contact_phone: schedulingPreference?.preferred_contact_phone ?? null,
        visit_before_contact_required: communicationPreference.visitBeforeContactRequired,
        first_visit_preferred_date:
          schedulingPreference?.first_visit_preferred_date?.toISOString() ?? null,
        first_visit_time_slot: schedulingPreference?.first_visit_time_slot ?? null,
        first_visit_time_note: schedulingPreference?.first_visit_time_note ?? null,
        parking_available: schedulingPreference?.parking_available ?? null,
        primary_contact_preference: schedulingPreference?.primary_contact_preference ?? null,
        mcs_linked: communicationPreference.mcsLinked,
      },
      baseline_context: {
        primary_disease: intake?.primary_disease ?? null,
        care_level: schedulingPreference?.care_level ?? intake?.care_level ?? null,
        adl_level: schedulingPreference?.adl_level ?? intake?.adl_level ?? null,
        dementia_level: schedulingPreference?.dementia_level ?? intake?.dementia_level ?? null,
        money_management: intake?.money_management ?? null,
        family_key_person: intake?.family_key_person ?? null,
        medication_support_methods: intake?.medication_support_methods ?? [],
        special_medical_procedures: intake?.special_medical_procedures ?? [],
        infection_isolation:
          intake?.infection_isolation ??
          (schedulingPreference?.infection_isolation ? '要隔離' : null),
        narcotics_base: intake?.narcotics_base ?? null,
        narcotics_rescue: intake?.narcotics_rescue ?? null,
        residual_medication_status: intake?.residual_medication_status ?? null,
      },
      latest_labs: keyAnalytes.map((lab) => ({
        analyte_code: lab.analyte_code,
        measured_at: lab.measured_at.toISOString(),
        value_numeric: lab.value_numeric,
        unit: lab.unit,
        abnormal_flag: lab.abnormal_flag,
      })),
      blockers: compactPreviewValues([
        patient.consents.length === 0 ? '訪問薬剤管理同意が未取得です。' : null,
        emergencyContacts.length === 0 ? '緊急連絡先が未登録です。' : null,
        !physicianTarget ? '主治医または依頼元医師情報が未設定です。' : null,
        !currentCase?.management_plans[0] ? '承認済み管理計画書がありません。' : null,
        communicationPreference.visitBeforeContactRequired &&
        !schedulingPreference?.preferred_contact_phone &&
        !patient.contacts.some((contact) => contact.phone)
          ? '訪問前連絡が必要ですが連絡先電話が不足しています。'
          : null,
      ]),
    },
    report_targets: [
      {
        key: 'physician_report' as const,
        label: '医師向け報告',
        available: Boolean(physicianTarget),
        source: physicianCareTeamTarget
          ? 'care_team'
          : physicianRequesterTarget
            ? 'requester'
            : 'missing',
        recipient_name: physicianTarget?.name ?? null,
        recipient_organization: physicianTarget?.organization_name ?? null,
        contact:
          compactPreviewValues([
            physicianTarget?.phone ? `TEL ${physicianTarget.phone}` : null,
            physicianTarget?.fax ? `FAX ${physicianTarget.fax}` : null,
            physicianTarget?.email ? physicianTarget.email : null,
          ]).join(' / ') || null,
      },
      {
        key: 'care_manager_report' as const,
        label: 'ケアマネ向け報告',
        available: Boolean(careManagerTarget),
        source: careManagerCareTeamTarget
          ? 'care_team'
          : careManagerIntakeTarget
            ? 'intake'
            : 'missing',
        recipient_name: careManagerTarget?.name ?? null,
        recipient_organization: careManagerTarget?.organization_name ?? null,
        contact:
          compactPreviewValues([
            careManagerTarget?.phone ? `TEL ${careManagerTarget.phone}` : null,
            careManagerTarget?.fax ? `FAX ${careManagerTarget.fax}` : null,
            careManagerTarget?.email ? careManagerTarget.email : null,
          ]).join(' / ') || null,
      },
      {
        key: 'nurse_share' as const,
        label: '訪問看護共有',
        available: Boolean(nurseTarget),
        source: nurseCareTeamTarget ? 'care_team' : nurseIntakeTarget ? 'intake' : 'missing',
        recipient_name: nurseTarget?.name ?? null,
        recipient_organization: nurseTarget?.organization_name ?? null,
        contact:
          compactPreviewValues([
            nurseTarget?.phone ? `TEL ${nurseTarget.phone}` : null,
            nurseTarget?.fax ? `FAX ${nurseTarget.fax}` : null,
            nurseTarget?.email ? nurseTarget.email : null,
          ]).join(' / ') || null,
      },
      {
        key: 'mcs' as const,
        label: 'MCS共有',
        available: communicationPreference.mcsLinked,
        source: communicationPreference.mcsLinked ? 'patient_setting' : 'missing',
        recipient_name: patient.mcs_link?.project_title ?? 'MCS連携',
        recipient_organization: null,
        contact: patient.mcs_link?.source_url ?? null,
        status: patient.mcs_link?.last_sync_status ?? null,
      },
    ],
    communication_priority: {
      preferred_contact_method: communicationPreference.preferredContactMethod,
      effective_channel: resolveVisitScheduleCommunicationChannel(
        'phone',
        communicationPreference.preferredContactMethod,
      ),
      visit_before_contact_required: communicationPreference.visitBeforeContactRequired,
      pharmacy_decision_due_date:
        communicationPreference.pharmacyDecisionDueDate?.toISOString() ?? null,
      targets: communicationTargets.map((target, index) => ({
        ...target,
        priority_order: index + 1,
      })),
      warnings: compactPreviewValues([
        communicationPreference.visitBeforeContactRequired
          ? '患者・家族への事前連絡を優先します。'
          : null,
        communicationPreference.pharmacyDecisionDueDate
          ? `薬局決定希望期限 ${format(communicationPreference.pharmacyDecisionDueDate, 'yyyy/MM/dd')}`
          : null,
        communicationTargets.length === 0 ? '有効な連携先が見つかっていません。' : null,
        communicationPreference.mcsLinked && !patient.mcs_link
          ? 'MCS連携フラグはありますが連携先 URL が未登録です。'
          : null,
      ]),
    },
  };
}
