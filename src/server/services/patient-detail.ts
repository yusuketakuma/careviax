import { endOfDay, format, startOfDay } from 'date-fns';
import type { MemberRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readJsonObjectString } from '@/lib/db/json';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import { getCycleWorkspaceAction } from '@/lib/prescription/cycle-workspace';
import { KEY_LAB_ANALYTE_CODES } from '@/lib/patient/lab-analytes';
import {
  getPatientPrivacyFlags,
  maskAddressDetail,
  maskInsuranceNumber,
  maskPhoneNumber,
} from '@/lib/patient/privacy';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { detectMedicationChanges } from '@/lib/prescription/medication-diff';
import { getPatientRiskSummary } from '@/server/services/patient-risk';
import { getPatientVisitBrief } from '@/server/services/visit-brief';
import { getPatientHomeCareFeatureSummary } from '@/server/services/home-care-ops';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import {
  buildAllergyLabel,
  buildCautionLabels,
  compactPreviewValues,
  sortHandlingTags,
  type WorkspaceConditionInput,
} from '@/server/services/patient-detail-helpers';
import {
  buildVisitScheduleCommunicationTargets,
  resolveVisitScheduleCommunicationChannel,
  type VisitScheduleSchedulingPreferenceContext,
} from '@/server/services/visit-schedule-communication';
import { runPatientDetailTasks } from '@/server/services/patient-detail-tasks';
import { buildPatientTimelineEvents } from '@/server/services/patient-detail-timeline-events';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import { buildExternalAccessGrantVisibilityWhere } from '@/server/services/external-access';

export { runPatientDetailTasks } from '@/server/services/patient-detail-tasks';
export { getPatientDocumentsData } from '@/server/services/patient-detail-documents';
export { getPatientReadinessData } from '@/server/services/patient-detail-readiness';

type DbClient = typeof prisma | Prisma.TransactionClient;
type PatientTimelineDb = {
  billingCandidate: Pick<Prisma.TransactionClient['billingCandidate'], 'findMany'>;
  careReport: Pick<Prisma.TransactionClient['careReport'], 'findMany'>;
  communicationEvent: Pick<Prisma.TransactionClient['communicationEvent'], 'findMany'>;
  conferenceNote: Pick<Prisma.TransactionClient['conferenceNote'], 'findMany'>;
  dispenseResult: Pick<Prisma.TransactionClient['dispenseResult'], 'findMany'>;
  externalAccessGrant: Pick<Prisma.TransactionClient['externalAccessGrant'], 'findMany'>;
  firstVisitDocument: Pick<Prisma.TransactionClient['firstVisitDocument'], 'findMany'>;
  inquiryRecord: Pick<Prisma.TransactionClient['inquiryRecord'], 'findMany'>;
  managementPlan: Pick<Prisma.TransactionClient['managementPlan'], 'findMany'>;
  medicationCycle: Pick<Prisma.TransactionClient['medicationCycle'], 'findMany'>;
  patient: Pick<Prisma.TransactionClient['patient'], 'findFirst'>;
  patientSelfReport: Pick<Prisma.TransactionClient['patientSelfReport'], 'findMany'>;
  prescriptionIntake: Pick<Prisma.TransactionClient['prescriptionIntake'], 'findMany'>;
  user: Pick<Prisma.TransactionClient['user'], 'findMany'>;
  visitRecord: Pick<Prisma.TransactionClient['visitRecord'], 'findMany'>;
  visitSchedule: Pick<Prisma.TransactionClient['visitSchedule'], 'findMany'>;
};

type DetailArgs = {
  orgId: string;
  patientId: string;
  role: MemberRole;
  userId: string;
};

const PATIENT_TIMELINE_EXTERNAL_SHARE_LIMIT = 8;

function buildPatientDetailWhere(args: DetailArgs): Prisma.PatientWhereInput {
  return applyPatientAssignmentWhere(
    {
      id: args.patientId,
      org_id: args.orgId,
    },
    {
      userId: args.userId,
      role: args.role,
    },
  );
}

function buildAssignedCareCaseWhere(
  args: DetailArgs,
  base?: Prisma.CareCaseWhereInput,
): Prisma.CareCaseWhereInput | undefined {
  const assignmentWhere = buildCareCaseAssignmentWhere({
    userId: args.userId,
    role: args.role,
  });
  if (!assignmentWhere) return base;
  if (!base) return assignmentWhere;
  return { AND: [base, assignmentWhere] };
}

function buildVisitRecordCaseScope(caseIds: string[]): Prisma.VisitRecordWhereInput {
  return {
    schedule: {
      case_id: { in: caseIds },
    },
  };
}

function buildCareReportCaseScope(caseIds: string[]): Prisma.CareReportWhereInput {
  return {
    OR: [{ case_id: { in: caseIds } }, { case_id: null }],
  };
}

function buildNullableCaseScope(caseIds: string[]) {
  return {
    OR: [{ case_id: null }, { case_id: { in: caseIds } }],
  };
}

async function listVisibleTimelineExternalShares(
  db: PatientTimelineDb,
  args: DetailArgs,
  caseIds: string[],
) {
  return db.externalAccessGrant.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      revoked_at: null,
      ...buildExternalAccessGrantVisibilityWhere(caseIds),
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: PATIENT_TIMELINE_EXTERNAL_SHARE_LIMIT,
    select: {
      id: true,
      granted_to_name: true,
      expires_at: true,
      accessed_at: true,
      created_at: true,
    },
  });
}

async function listBillingCaseRefs(db: PatientTimelineDb, args: DetailArgs, caseIds: string[]) {
  if (caseIds.length === 0) {
    return { visitRecordIds: [] as string[], cycleIds: [] as string[] };
  }

  const [visitRecords, cycles] = await Promise.all([
    db.visitRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...buildVisitRecordCaseScope(caseIds),
      },
      select: { id: true },
    }),
    db.medicationCycle.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        case_id: { in: caseIds },
      },
      select: { id: true },
    }),
  ]);

  return {
    visitRecordIds: visitRecords.map((item) => item.id),
    cycleIds: cycles.map((item) => item.id),
  };
}

async function findPatientOverviewBase(db: DbClient, args: DetailArgs) {
  return db.patient.findFirst({
    where: buildPatientDetailWhere(args),
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
        ...(buildAssignedCareCaseWhere(args) ? { where: buildAssignedCareCaseWhere(args) } : {}),
        orderBy: { created_at: 'desc' },
        include: {
          care_team_links: true,
        },
      },
    },
  });
}

async function listLabSummary(db: DbClient, args: Pick<DetailArgs, 'orgId' | 'patientId'>) {
  const labRows = await db.patientLabObservation.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      analyte_code: { in: [...KEY_LAB_ANALYTE_CODES] },
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

/**
 * 06_card「直近の動き」: 工程遷移(to_status)→ 出来事ラベル。
 * 例: dispensed への遷移 =「調剤 完了」(設計画像の『調剤 完了 — 佐藤』)。
 */
const CYCLE_TRANSITION_EVENT_LABELS: Record<string, string> = {
  intake_received: '処方 取込',
  structuring: '処方入力 開始',
  inquiry_pending: '疑義照会 送信',
  inquiry_resolved: '疑義照会 回答受領',
  ready_to_dispense: '処方確認 完了',
  dispensing: '調剤 開始',
  dispensed: '調剤 完了',
  audit_pending: '監査 開始',
  audited: '監査 完了',
  setting: 'セット作業 開始',
  set_audited: 'セット監査 完了',
  visit_ready: '訪問準備 完了',
  visit_completed: '訪問 完了',
  reported: '報告 完了',
  on_hold: '保留',
  cancelled: '中止',
};

/**
 * p0_08 カード詳細ワークスペース用の工程集約。
 * 進行中サイクルの現在工程・止まっている理由・処方の変化・セットの注意に加え、
 * 06_card(カード=1 RX の作業台)用に安全情報・処方明細全行・直近の動き・今日のタスクを集約する。
 */
async function buildPatientWorkspace(
  db: DbClient,
  args: Pick<DetailArgs, 'orgId' | 'patientId'> & {
    caseIds: string[];
    allergyInfo: unknown;
    conditions: WorkspaceConditionInput[];
    swallowingRoute: string | null;
  },
) {
  if (args.caseIds.length === 0) return null;

  const cycle = await db.medicationCycle.findFirst({
    where: {
      org_id: args.orgId,
      case_id: { in: args.caseIds },
      overall_status: { notIn: ['reported', 'cancelled'] },
    },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      overall_status: true,
      exception_status: true,
      prescription_intakes: {
        orderBy: { prescribed_date: 'desc' },
        take: 2,
        select: {
          id: true,
          prescribed_date: true,
          original_document_url: true,
          prescription_category: true,
          prescriber_institution: true,
          created_at: true,
          lines: {
            orderBy: { line_number: 'asc' },
            select: {
              id: true,
              drug_name: true,
              drug_code: true,
              dose: true,
              frequency: true,
              days: true,
              quantity: true,
              unit: true,
              start_date: true,
              end_date: true,
              dispensing_method: true,
              packaging_instruction_tags: true,
            },
          },
        },
      },
      set_plans: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: {
          id: true,
          set_method: true,
          notes: true,
          target_period_start: true,
          target_period_end: true,
        },
      },
      workflow_exceptions: {
        where: { status: 'open' },
        orderBy: [{ severity: 'asc' }, { created_at: 'asc' }],
        select: {
          id: true,
          exception_type: true,
          description: true,
          severity: true,
          created_at: true,
        },
      },
      transition_logs: {
        orderBy: { created_at: 'desc' },
        take: 5,
        select: {
          id: true,
          from_status: true,
          to_status: true,
          actor_id: true,
          created_at: true,
        },
      },
      inquiries: {
        orderBy: { inquired_at: 'desc' },
        take: 5,
        select: {
          id: true,
          reason: true,
          inquired_at: true,
          resolved_at: true,
        },
      },
      dispense_tasks: {
        // completed = 調剤完了・監査待ち(/api/dispense-audits のキュー前提)も
        // 期限表示の対象に含める
        where: { status: { in: ['pending', 'in_progress', 'completed'] } },
        orderBy: { due_date: 'asc' },
        take: 1,
        select: {
          id: true,
          due_date: true,
        },
      },
    },
  });

  if (!cycle) return null;

  const now = new Date();
  const [egfrObservation, todayVisits, actorNameMap] = await Promise.all([
    db.patientLabObservation.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        analyte_code: 'egfr',
      },
      orderBy: { measured_at: 'desc' },
      select: {
        value_numeric: true,
        value_text: true,
        measured_at: true,
      },
    }),
    db.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        case_id: { in: args.caseIds },
        scheduled_date: { gte: startOfDay(now), lte: endOfDay(now) },
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
      },
      orderBy: [{ time_window_start: 'asc' }],
      select: {
        id: true,
        time_window_start: true,
      },
    }),
    batchResolveNames(db as typeof prisma, args.orgId, [
      ...new Set(cycle.transition_logs.map((log) => log.actor_id)),
    ]),
  ]);

  const [currentIntake, previousIntake] = cycle.prescription_intakes;

  const toPeriod = (lines: Array<{ start_date: Date | null; end_date: Date | null }>) => {
    const starts = lines.map((line) => line.start_date).filter((d): d is Date => d != null);
    const ends = lines.map((line) => line.end_date).filter((d): d is Date => d != null);
    return {
      start: starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
      end: ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
    };
  };

  const rawChanges =
    currentIntake && previousIntake
      ? detectMedicationChanges(currentIntake.lines, previousIntake.lines)
      : [];
  const currentLineByName = new Map(
    (currentIntake?.lines ?? []).map((line) => [line.drug_name, line]),
  );
  const medicationChanges = rawChanges.map((change) => {
    const currentLine = currentLineByName.get(change.drug_name) ?? null;
    return {
      change_type: change.change_type,
      drug_name: change.drug_name,
      frequency: change.change_type === 'removed' ? null : (currentLine?.frequency ?? null),
      days: change.change_type === 'removed' ? null : (currentLine?.days ?? null),
    };
  });

  const currentLines = currentIntake?.lines ?? [];

  // セーフティボード: 取扱タグ = 現行処方行の packaging_instruction_tags + 一包化(dispensing_method)集約
  const handlingTags = sortHandlingTags([
    ...currentLines.flatMap((line) => line.packaging_instruction_tags as string[]),
    ...(currentLines.some((line) => line.dispensing_method === 'unit_dose') ? ['unit_dose'] : []),
  ]);
  const egfrValue = egfrObservation?.value_numeric ?? egfrObservation?.value_text ?? null;
  const safety = {
    allergy: buildAllergyLabel(args.allergyInfo),
    renal:
      egfrObservation && egfrValue != null
        ? `eGFR ${egfrValue}(${format(egfrObservation.measured_at, 'M/d')})`
        : null,
    handling_tags: handlingTags,
    swallowing: args.swallowingRoute?.trim() || null,
    cautions: buildCautionLabels(args.conditions),
  };

  // 直近の動き: 工程遷移 + 疑義照会 + 処方取込を時系列(降順)で 5 件
  const recentActivities = [
    ...cycle.transition_logs.map((log) => ({
      id: `transition-${log.id}`,
      type: 'transition' as const,
      label:
        CYCLE_TRANSITION_EVENT_LABELS[log.to_status] ?? `${log.from_status} → ${log.to_status}`,
      actor: actorNameMap.get(log.actor_id) ?? null,
      at: log.created_at,
      href: getCycleWorkspaceAction(log.to_status)?.actionHref ?? '/workflow',
    })),
    ...cycle.inquiries.map((inquiry) => ({
      id: `inquiry-${inquiry.id}`,
      type: 'inquiry' as const,
      label: inquiry.resolved_at
        ? `${inquiry.reason} → 疑義照会 回答受領`
        : `${inquiry.reason} → 疑義照会 回答待ち`,
      actor: null,
      at: inquiry.resolved_at ?? inquiry.inquired_at,
      href: '/communications/requests',
    })),
    ...cycle.prescription_intakes.map((intake) => ({
      id: `intake-${intake.id}`,
      type: 'intake' as const,
      label: `${intake.prescription_category === 'emergency' ? '臨時' : '定期'}処方 取込${
        intake.prescriber_institution ? `(${intake.prescriber_institution})` : ''
      }`,
      actor: null,
      at: intake.created_at,
      href: '/prescriptions',
    })),
  ]
    .sort((left, right) => right.at.getTime() - left.at.getTime())
    .slice(0, 5)
    .map((activity) => ({ ...activity, at: activity.at.toISOString() }));

  // このカードに紐づく今日: 監査待ち → セット予定 → 当日訪問の順序つきタスク
  const hasNarcotic = currentLines.some((line) =>
    (line.packaging_instruction_tags as string[]).includes('narcotic'),
  );
  const auditPending = ['dispensed', 'audit_pending'].includes(cycle.overall_status);
  const auditDue = cycle.dispense_tasks[0]?.due_date ?? null;
  const auditDueTime = auditDue ? format(auditDue, 'HH:mm') : null;
  const todayTasks = [
    ...(auditPending
      ? [
          {
            id: `audit-${cycle.id}`,
            tone: 'deadline' as const,
            time_label: auditDueTime ? `期限 ${auditDueTime}` : '監査待ち',
            label: hasNarcotic ? '麻薬監査' : '調剤監査',
            href: '/auditing',
            action_label: '監査へ',
            due_time: auditDueTime,
          },
        ]
      : []),
    ...(['dispensed', 'audit_pending', 'audited', 'setting'].includes(cycle.overall_status)
      ? [
          {
            id: `set-${cycle.id}`,
            tone: 'waiting' as const,
            time_label: auditPending
              ? '監査後'
              : cycle.overall_status === 'setting'
                ? '進行中'
                : '未着手',
            label: 'セット作成',
            href: '/medication-sets',
            action_label: 'セットへ',
            due_time: null,
          },
        ]
      : []),
    ...todayVisits.map((visit) => ({
      id: `visit-${visit.id}`,
      tone: 'scheduled' as const,
      time_label: visit.time_window_start ? format(visit.time_window_start, 'HH:mm') : '時間未定',
      label: '訪問',
      href: '/schedules',
      action_label: '訪問へ',
      due_time: null,
    })),
  ];

  return {
    cycle_id: cycle.id,
    overall_status: cycle.overall_status,
    exception_status: cycle.exception_status,
    current_intake: currentIntake
      ? {
          id: currentIntake.id,
          prescribed_date: currentIntake.prescribed_date.toISOString(),
        }
      : null,
    safety,
    prescription_lines: currentLines.map((line) => ({
      id: line.id,
      drug_name: line.drug_name,
      dose: line.dose,
      frequency: line.frequency,
      days: line.days,
      quantity: line.quantity,
      unit: line.unit,
      packaging_instruction_tags: line.packaging_instruction_tags as string[],
    })),
    recent_activities: recentActivities,
    today_tasks: todayTasks,
    open_exceptions: cycle.workflow_exceptions.map((exception) => ({
      id: exception.id,
      exception_type: exception.exception_type,
      description: exception.description,
      severity: exception.severity === 'critical' ? 'critical' : 'warning',
      created_at: exception.created_at.toISOString(),
    })),
    medication_changes: medicationChanges,
    previous_medication: previousIntake ? toPeriod(previousIntake.lines) : null,
    current_medication: currentIntake ? toPeriod(currentIntake.lines) : null,
    set_plan: cycle.set_plans[0]
      ? {
          id: cycle.set_plans[0].id,
          set_method: cycle.set_plans[0].set_method,
          notes: cycle.set_plans[0].notes,
          target_period_start: cycle.set_plans[0].target_period_start,
          target_period_end: cycle.set_plans[0].target_period_end,
          processing: {
            unit_dose: (currentIntake?.lines ?? []).some(
              (line) => line.dispensing_method === 'unit_dose',
            ),
            separate_pack: (currentIntake?.lines ?? []).some((line) =>
              line.packaging_instruction_tags.includes('separate_pack'),
            ),
            crushed: (currentIntake?.lines ?? []).some(
              (line) => line.dispensing_method === 'crushed',
            ),
          },
        }
      : null,
    prescription_document_url: currentIntake?.original_document_url ?? null,
  };
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
    workspace,
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
            time_window_start: true,
            confirmed_at: true,
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
      caseIds,
    }),
    getPatientVisitBrief(db, {
      orgId: args.orgId,
      patientId: args.patientId,
      context: 'patient',
      caseIds,
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
    buildPatientWorkspace(db, {
      orgId: args.orgId,
      patientId: args.patientId,
      caseIds,
      allergyInfo: patient.allergy_info,
      conditions: patient.conditions,
      swallowingRoute: patient.scheduling_preference?.swallowing_route ?? null,
    }),
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
    workspace,
    privacy: {
      sensitive_fields_masked: privacy.sensitiveFieldsMasked,
      address_fields_masked: privacy.addressFieldsMasked,
      can_view_detail: privacy.canViewDetail,
    },
  };
}

export async function getPatientVisitsData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      cases: {
        ...(buildAssignedCareCaseWhere(args) ? { where: buildAssignedCareCaseWhere(args) } : {}),
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  // scheduled_date(@db.Date)比較用: ローカル今月の月初/翌月初を UTC 深夜で表す
  const [currentYear, currentMonth] = localDateKey().split('-').map(Number);
  const currentMonthStart = utcDateFromLocalKey(
    `${currentYear}-${`${currentMonth}`.padStart(2, '0')}-01`,
  );
  const nextMonthStart = new Date(Date.UTC(currentYear, currentMonth, 1));

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
              ...buildVisitRecordCaseScope(caseIds),
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
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      cases: {
        ...(buildAssignedCareCaseWhere(args) ? { where: buildAssignedCareCaseWhere(args) } : {}),
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const billingRefs = await listBillingCaseRefs(db, args, caseIds);
  const billingEvidenceScope =
    billingRefs.visitRecordIds.length === 0 && billingRefs.cycleIds.length === 0
      ? { id: { in: [] } }
      : {
          OR: [
            { visit_record_id: { in: billingRefs.visitRecordIds } },
            { cycle_id: { in: billingRefs.cycleIds } },
          ],
        };
  const billingCandidateScope =
    billingRefs.cycleIds.length === 0
      ? { id: { in: [] } }
      : { cycle_id: { in: billingRefs.cycleIds } };
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
        OR: [{ case_id: { in: caseIds } }, { case_id: null }],
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
        ...billingEvidenceScope,
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
      visitRecordIds: billingRefs.visitRecordIds,
      cycleIds: billingRefs.cycleIds,
      limit: 6,
    }),
    db.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...billingCandidateScope,
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
      caseIds,
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
        effective_revision_code: readJsonObjectString(
          item.calculation_context,
          'effective_revision_code',
        ),
        site_config_status: readJsonObjectString(item.calculation_context, 'site_config_status'),
        blockers: billingEvidenceBlockers.find((blocker) => blocker.id === item.id)?.blockers ?? [],
      })),
      candidates: billingCandidates.map((item) => ({
        ...item,
        effective_revision_code: readJsonObjectString(item.source_snapshot, 'revision_code'),
        site_config_status: readJsonObjectString(item.source_snapshot, 'site_config_status'),
      })),
      claimable_count: billingEvidence.filter((item) => item.claimable).length,
      blocked_count: billingEvidence.filter((item) => !item.claimable).length,
    },
  };
}

export async function getPatientTimelineData(db: PatientTimelineDb, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      cases: {
        ...(buildAssignedCareCaseWhere(args) ? { where: buildAssignedCareCaseWhere(args) } : {}),
        select: {
          id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const billingRefs = await listBillingCaseRefs(db, args, caseIds);

  const {
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
  } = await runPatientDetailTasks({
    visitSchedules: () =>
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
    visitRecords: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.visitRecord.findMany({
            where: {
              org_id: args.orgId,
              patient_id: args.patientId,
              ...buildVisitRecordCaseScope(caseIds),
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
    careReports: () =>
      db.careReport.findMany({
        where: {
          org_id: args.orgId,
          patient_id: args.patientId,
          ...buildCareReportCaseScope(caseIds),
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
    communicationEvents: () =>
      db.communicationEvent.findMany({
        where: {
          org_id: args.orgId,
          patient_id: args.patientId,
          event_type: { not: 'patient_self_report' },
          ...buildNullableCaseScope(caseIds),
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
    selfReports: () =>
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
    externalShares: () => listVisibleTimelineExternalShares(db, args, caseIds),
    inquiryRecords: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.inquiryRecord.findMany({
            where: {
              org_id: args.orgId,
              cycle: {
                patient_id: args.patientId,
                case_id: { in: caseIds },
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
    prescriptionIntakes: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.prescriptionIntake.findMany({
            where: {
              org_id: args.orgId,
              cycle: {
                patient_id: args.patientId,
                case_id: { in: caseIds },
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
    dispenseResults: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.dispenseResult.findMany({
            where: {
              org_id: args.orgId,
              line: {
                intake: {
                  cycle: {
                    patient_id: args.patientId,
                    case_id: { in: caseIds },
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
    managementPlans: () =>
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
    firstVisitDocuments: () =>
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
    conferenceNotes: () =>
      caseIds.length === 0
        ? Promise.resolve([])
        : db.conferenceNote.findMany({
            where: {
              org_id: args.orgId,
              OR: [{ patient_id: args.patientId, case_id: null }, { case_id: { in: caseIds } }],
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
    billingCandidates: () =>
      db.billingCandidate.findMany({
        where: {
          org_id: args.orgId,
          patient_id: args.patientId,
          ...(billingRefs.cycleIds.length === 0
            ? { id: { in: [] } }
            : { cycle_id: { in: billingRefs.cycleIds } }),
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
  });

  const actorNameMap = await batchResolveNames(
    db,
    args.orgId,
    Array.from(
      new Set(
        compactPreviewValues([
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

  const timelineEvents = buildPatientTimelineEvents({
    patientId: args.patientId,
    actorNameMap,
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
  });

  return {
    timeline_events: timelineEvents,
    self_reports: selfReports,
  };
}

export async function getPatientWorkflowPreviewData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
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
        ...(buildAssignedCareCaseWhere(args) ? { where: buildAssignedCareCaseWhere(args) } : {}),
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
