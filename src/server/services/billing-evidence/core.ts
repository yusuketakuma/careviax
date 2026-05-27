import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { findActiveVisitConsent, findCurrentManagementPlan } from '../management-plans';
import { upsertOperationalTask, resolveOperationalTasks } from '../operational-tasks';
import { resolveBillingPayerBasis } from '../billing-payer-basis';
import { resolvePatientInsurance } from '../patient-insurance';
import { findLatestPrescriptionIntakeClassification } from '../prescription-intake-classification';
import {
  buildBillingCandidateSpecs,
  ensureHomeCareBillingSsot,
  HOME_CARE_BILLING_RULESET_VERSION,
} from '../home-care-billing-ssot';
import { resolveBillingRuntimeContext } from '../billing-runtime-context';
import { getHomeVisit2026BillingEligibility } from '@/lib/visits/home-visit-2026-evidence';
import type { StructuredSoap } from '@/types/structured-soap';

export type Tx = Prisma.TransactionClient | typeof prisma;

export type BillingCandidateWorkflowState = {
  review_state: 'pending' | 'reviewed';
  resolution_state: 'unresolved' | 'confirmed' | 'excluded';
  reviewed_at: string | null;
  reviewed_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  note: string | null;
};

export type BillingValidationLayerState = 'passed' | 'manual_review' | 'blocked';

export type BillingValidationLayer = {
  label: string;
  state: BillingValidationLayerState;
  message: string;
  version?: string;
};

export type BillingValidationLayers = {
  evidence: BillingValidationLayer;
  rule_engine: BillingValidationLayer;
  close_review: BillingValidationLayer;
};

export type AdditionalBillingRuleDefinition = {
  ssotKey: string;
  code: string;
  name: string;
  points: number;
  sourceNote: string;
  targetLabel: string;
};

const CONFERENCE_BILLING_RULE_KEYS: Record<string, string> = {
  'B011-6': 'medical.discharge_joint_guidance',
  MED_INFO_PROVISION_2_HA: 'medical.information_provision.2_care_manager',
  C013: 'medical.addition.terminal_care',
  MED_EMERGENCY_JOINT_GUIDANCE: 'medical.emergency_joint_guidance',
};

export type BillingEvidenceBlocker = {
  key:
    | 'missing_visit_consent'
    | 'missing_management_plan'
    | 'management_plan_review_overdue'
    | 'initial_home_visit_assessment_missing'
    | 'report_delivery_incomplete'
    | 'outcome_not_claimable';
  reason: string;
  action_href: string;
  action_label: string;
  severity: 'urgent' | 'high' | 'normal';
};

function isUnderAge(birthDate: Date, referenceDate: Date, threshold: number): boolean {
  const ageYears = referenceDate.getFullYear() - birthDate.getFullYear();
  const hadBirthday =
    referenceDate.getMonth() > birthDate.getMonth() ||
    (referenceDate.getMonth() === birthDate.getMonth() &&
      referenceDate.getDate() >= birthDate.getDate());
  return hadBirthday ? ageYears < threshold : ageYears - 1 < threshold;
}

function resolveAfterHoursVisitCategory(args: {
  visitDate: Date;
  isHoliday: boolean;
}): 'night' | 'holiday' | 'midnight' | null {
  const hours = args.visitDate.getHours();
  const minutes = args.visitDate.getMinutes();
  const seconds = args.visitDate.getSeconds();
  const hasMeaningfulTime = hours !== 0 || minutes !== 0 || seconds !== 0;

  if (args.isHoliday) return 'holiday';
  if (!hasMeaningfulTime) return null;
  if (hours >= 22 || hours < 6) return 'midnight';
  if (hours < 8 || hours >= 18) return 'night';
  return null;
}

export function startOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function endOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

const JAPAN_TIME_ZONE_OFFSET_MS = 9 * 60 * 60 * 1000;

function japanCivilMonthParts(value: Date) {
  const japanDate = new Date(value.getTime() + JAPAN_TIME_ZONE_OFFSET_MS);
  return {
    year: japanDate.getUTCFullYear(),
    monthIndex: japanDate.getUTCMonth(),
  };
}

export function billingMonthForJapanTimestamp(value: Date) {
  const { year, monthIndex } = japanCivilMonthParts(value);
  return new Date(Date.UTC(year, monthIndex, 1));
}

export function japanMonthRangeForBillingMonth(value: Date) {
  const monthStart = startOfMonth(value);
  const year = monthStart.getUTCFullYear();
  const monthIndex = monthStart.getUTCMonth();
  const start = new Date(Date.UTC(year, monthIndex, 1) - JAPAN_TIME_ZONE_OFFSET_MS);
  const nextStart = new Date(Date.UTC(year, monthIndex + 1, 1) - JAPAN_TIME_ZONE_OFFSET_MS);
  return {
    start,
    nextStart,
    end: new Date(nextStart.getTime() - 1),
  };
}

function startOfWeek(value: Date) {
  const date = new Date(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfWeek(value: Date) {
  const date = new Date(value);
  date.setDate(date.getDate() + 6);
  date.setHours(23, 59, 59, 999);
  return date;
}

function isClaimableOutcome(outcome: string) {
  return ['completed', 'completed_with_issue', 'revisit_needed'].includes(outcome);
}

function hasDeliveredReportStatus(status: string) {
  return ['sent', 'confirmed'].includes(status);
}

function areReportsDelivered(args: {
  reports: Array<{ status: string }>;
  deliveryRecords: Array<{ status: string }>;
  expectedReportCount?: number;
}) {
  if (args.expectedReportCount != null && args.reports.length !== args.expectedReportCount) {
    return false;
  }
  if (args.reports.length === 0) {
    return false;
  }
  if (!args.reports.every((report) => hasDeliveredReportStatus(report.status))) {
    return false;
  }

  // Legacy records may not have DeliveryRecord rows yet; preserve sent/confirmed CareReport semantics.
  return (
    args.deliveryRecords.length === 0 ||
    args.deliveryRecords.every((delivery) => hasDeliveredReportStatus(delivery.status))
  );
}

function buildBillingTaskKey(visitRecordId: string) {
  return `billing-evidence:${visitRecordId}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function csvFromUnique(values: Array<string | null | undefined>) {
  const unique = Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  );
  return unique.length > 0 ? unique.join(',') : null;
}

async function listJahisSupplementalRecordsForBilling(
  tx: Tx,
  args: { orgId: string; patientId: string },
) {
  const client = (
    tx as unknown as {
      jahisSupplementalRecord?: {
        findMany?: (args: Record<string, unknown>) => Promise<
          Array<{
            record_type: string;
            record_label: string;
            summary: string | null;
            raw_line: string;
          }>
        >;
      };
    }
  ).jahisSupplementalRecord;

  if (!client?.findMany) return [];

  return client.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
    },
    orderBy: [{ created_at: 'desc' }, { line_number: 'asc' }],
    take: 12,
    select: {
      record_type: true,
      record_label: true,
      summary: true,
      raw_line: true,
    },
  });
}

function readConferenceCandidateLinkage(sourceSnapshot: Prisma.JsonValue | null) {
  if (!isRecord(sourceSnapshot) || sourceSnapshot.source_type !== 'conference_note') {
    return null;
  }

  const conferenceNoteId =
    typeof sourceSnapshot.conference_note_id === 'string'
      ? sourceSnapshot.conference_note_id
      : null;
  if (!conferenceNoteId) return null;

  return {
    conferenceNoteId,
  };
}

function hasInitialHomeVisitAssessmentEvidence(record: {
  soap_objective: string | null;
  soap_assessment: string | null;
  structured_soap: Prisma.JsonValue | null;
}) {
  if (record.soap_objective?.trim() || record.soap_assessment?.trim()) {
    return true;
  }

  if (!isRecord(record.structured_soap) || !isRecord(record.structured_soap.objective)) {
    return false;
  }

  const objective = record.structured_soap.objective;
  const freeText = typeof objective.free_text === 'string' ? objective.free_text.trim() : '';
  const functionalAssessment = isRecord(objective.functional_assessment)
    ? objective.functional_assessment
    : null;
  const hasFunctionalAssessment =
    functionalAssessment != null &&
    Object.values(functionalAssessment).some(
      (value) =>
        Array.isArray(value) &&
        value.some((entry) => typeof entry === 'string' && entry.trim().length > 0),
    );

  return freeText.length > 0 || hasFunctionalAssessment;
}

export async function evaluateInitialHomeVisitAssessmentRequirement(
  tx: Tx,
  args: { orgId: string; patientId: string; targetDate: Date },
) {
  const cutoff = new Date(args.targetDate);
  cutoff.setHours(0, 0, 0, 0);

  const priorClaimableVisitCount = await tx.visitRecord.count({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      visit_date: { lt: cutoff },
      outcome_status: {
        in: ['completed', 'completed_with_issue', 'revisit_needed', 'delivery_only'],
      },
    },
  });

  if (priorClaimableVisitCount > 0) {
    return {
      required: false,
      satisfied: true,
      initialVisitRecordId: null,
      reason: null,
    };
  }

  const initialVisitRecord = await tx.visitRecord.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      visit_date: { lt: cutoff },
      outcome_status: {
        in: ['completed', 'completed_with_issue', 'revisit_needed', 'delivery_only'],
      },
      schedule: {
        visit_type: 'initial',
      },
    },
    orderBy: [{ visit_date: 'desc' }],
    select: {
      id: true,
      soap_objective: true,
      soap_assessment: true,
      structured_soap: true,
    },
  });

  const satisfied =
    initialVisitRecord != null && hasInitialHomeVisitAssessmentEvidence(initialVisitRecord);

  return {
    required: true,
    satisfied,
    initialVisitRecordId: initialVisitRecord?.id ?? null,
    reason: satisfied
      ? null
      : '初回算定月のため、初回訪問前日までの患家訪問・環境聴取記録が必要です',
  };
}

export function readBillingCandidateWorkflowState(
  sourceSnapshot: Prisma.JsonValue | null | undefined,
): BillingCandidateWorkflowState {
  const workflow =
    isRecord(sourceSnapshot) && isRecord(sourceSnapshot.billing_close)
      ? sourceSnapshot.billing_close
      : {};

  return {
    review_state: workflow.review_state === 'reviewed' ? 'reviewed' : 'pending',
    resolution_state:
      workflow.resolution_state === 'confirmed' || workflow.resolution_state === 'excluded'
        ? workflow.resolution_state
        : 'unresolved',
    reviewed_at: typeof workflow.reviewed_at === 'string' ? workflow.reviewed_at : null,
    reviewed_by: typeof workflow.reviewed_by === 'string' ? workflow.reviewed_by : null,
    closed_at: typeof workflow.closed_at === 'string' ? workflow.closed_at : null,
    closed_by: typeof workflow.closed_by === 'string' ? workflow.closed_by : null,
    note: typeof workflow.note === 'string' ? workflow.note : null,
  };
}

export function writeBillingCandidateWorkflowState(
  sourceSnapshot: Prisma.JsonValue | null | undefined,
  workflow: Partial<BillingCandidateWorkflowState>,
): Prisma.InputJsonValue {
  const current = isRecord(sourceSnapshot) ? sourceSnapshot : {};
  const nextWorkflow = {
    ...readBillingCandidateWorkflowState(sourceSnapshot),
    ...workflow,
  };

  return {
    ...current,
    billing_close: nextWorkflow,
  } as Prisma.InputJsonValue;
}

export function buildValidationLayers(args: {
  evidencePassed: boolean;
  evidenceMessage: string;
  ruleMessage: string;
  candidateStatus: string;
  workflow: BillingCandidateWorkflowState;
}): BillingValidationLayers {
  const reviewState =
    args.candidateStatus === 'exported' || args.workflow.closed_at
      ? 'passed'
      : args.workflow.review_state === 'reviewed' && args.workflow.resolution_state === 'confirmed'
        ? 'passed'
        : args.workflow.review_state === 'reviewed' && args.workflow.resolution_state === 'excluded'
          ? 'blocked'
          : 'manual_review';

  return {
    evidence: {
      label: '請求根拠',
      state: args.evidencePassed ? 'passed' : 'blocked',
      message: args.evidenceMessage,
    },
    rule_engine: {
      label: '算定ルール',
      state:
        args.candidateStatus === 'excluded'
          ? 'blocked'
          : args.candidateStatus === 'candidate'
            ? 'manual_review'
            : 'passed',
      message: args.ruleMessage,
      version: HOME_CARE_BILLING_RULESET_VERSION,
    },
    close_review: {
      label: '月次締めレビュー',
      state: reviewState,
      message:
        reviewState === 'passed'
          ? 'レビュー完了'
          : reviewState === 'blocked'
            ? 'レビューで除外'
            : 'レビュー待ち',
    },
  };
}

export function mergeCandidateSourceSnapshot(args: {
  sourceSnapshot: Record<string, unknown>;
  calculationContext: Prisma.JsonValue | null | undefined;
  candidateStatus: string;
  claimable: boolean;
  evidenceMessage: string;
  ruleMessage: string;
  workflow: BillingCandidateWorkflowState;
}) {
  const calculationContext = isRecord(args.calculationContext) ? args.calculationContext : {};
  return {
    ...args.sourceSnapshot,
    ruleset_version: HOME_CARE_BILLING_RULESET_VERSION,
    billing_assignment: {
      building_id:
        typeof calculationContext.building_id === 'string' ? calculationContext.building_id : null,
      unit_name:
        typeof calculationContext.unit_name === 'string' ? calculationContext.unit_name : null,
      assignment_scope:
        typeof calculationContext.assignment_scope === 'string'
          ? calculationContext.assignment_scope
          : 'patient',
      building_patient_count:
        typeof calculationContext.building_patient_count === 'number'
          ? calculationContext.building_patient_count
          : null,
      unit_patient_count:
        typeof calculationContext.unit_patient_count === 'number'
          ? calculationContext.unit_patient_count
          : null,
    },
    validation_layers: buildValidationLayers({
      evidencePassed: args.claimable,
      evidenceMessage: args.evidenceMessage,
      ruleMessage: args.ruleMessage,
      candidateStatus: args.candidateStatus,
      workflow: args.workflow,
    }),
  };
}

/**
 * 単一建物診療患者数を算出する。
 *
 * 算定ルール (厚労省告示):
 *  原則: 同一建物内で当該薬局が訪問指導を実施している患者数
 *
 *  特例 — 以下のいずれかに該当する場合は「1人」扱い:
 *   ① 同一世帯の複数患者 (同一 patient_id の世帯員は Residence が分かれない前提)
 *   ② 建物の総戸数 < 20 かつ 対象患者数 ≤ 2
 *   ③ 対象患者数 ≤ 建物の総戸数の 10%
 *   ④ グループホーム (ユニット数 3 以下) → ユニット単位でカウント
 */
type PrimaryResidenceForBilling = Awaited<ReturnType<typeof fetchPrimaryResidenceForBilling>>;

async function fetchPrimaryResidenceForBilling(tx: Tx, args: { orgId: string; patientId: string }) {
  return tx.residence.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      is_primary: true,
    },
    select: {
      building_id: true,
      unit_name: true,
      facility_id: true,
      facility_unit_id: true,
      facility: {
        select: {
          id: true,
          facility_type: true,
          total_units: true,
          units: { select: { id: true } },
        },
      },
    },
  });
}

async function resolveBuildingPatientCount(
  tx: Tx,
  args: { orgId: string; patientId: string },
  primaryResidence?: PrimaryResidenceForBilling,
) {
  if (primaryResidence === undefined) {
    primaryResidence = await fetchPrimaryResidenceForBilling(tx, args);
  }

  // 在宅個人宅 (施設なし) → 1人
  const facilityId = primaryResidence?.facility_id;
  const buildingId = primaryResidence?.building_id;
  if (!facilityId && !buildingId) return 1;

  // 同一建物/施設の対象患者数を取得
  const whereClause = facilityId
    ? { org_id: args.orgId, facility_id: facilityId, is_primary: true }
    : { org_id: args.orgId, building_id: buildingId, is_primary: true };
  const totalPatientsInBuilding = await tx.residence.count({ where: whereClause });

  if (totalPatientsInBuilding <= 1) return 1;

  const facility = primaryResidence?.facility;

  // ── 特例②: 総戸数 < 20 かつ 対象患者 ≤ 2 → 1人扱い ──
  const totalUnits = facility?.total_units;
  if (totalUnits != null && totalUnits < 20 && totalPatientsInBuilding <= 2) {
    return 1;
  }

  // ── 特例③: 対象患者数 ≤ 総戸数の 10% → 1人扱い ──
  if (totalUnits != null && totalUnits > 0 && totalPatientsInBuilding <= totalUnits * 0.1) {
    return 1;
  }

  // ── 特例④: グループホーム (ユニット数 3 以下) → ユニット単位カウント ──
  if (
    facility?.facility_type === 'group_home' &&
    facility.units.length <= 3 &&
    primaryResidence?.facility_unit_id
  ) {
    const unitPatientCount = await tx.residence.count({
      where: {
        org_id: args.orgId,
        facility_unit_id: primaryResidence.facility_unit_id,
        is_primary: true,
      },
    });
    return unitPatientCount;
  }

  // ── 原則: 建物全体の患者数 ──
  return totalPatientsInBuilding;
}

async function resolveBillingAssignment(
  tx: Tx,
  args: { orgId: string; patientId: string },
  primaryResidence?: PrimaryResidenceForBilling,
) {
  if (primaryResidence === undefined) {
    primaryResidence = await fetchPrimaryResidenceForBilling(tx, args);
  }

  if (!primaryResidence?.building_id) {
    return {
      building_id: null,
      unit_name: primaryResidence?.unit_name ?? null,
      building_patient_count: 1,
      unit_patient_count: 1,
      assignment_scope: 'patient' as const,
    };
  }

  const [buildingPatientCount, unitPatientCount] = await Promise.all([
    tx.residence.count({
      where: {
        org_id: args.orgId,
        building_id: primaryResidence.building_id,
        is_primary: true,
      },
    }),
    primaryResidence.unit_name
      ? tx.residence.count({
          where: {
            org_id: args.orgId,
            building_id: primaryResidence.building_id,
            unit_name: primaryResidence.unit_name,
            is_primary: true,
          },
        })
      : Promise.resolve(1),
  ]);

  const assignmentScope =
    buildingPatientCount > 1 ? 'building' : unitPatientCount > 1 ? 'unit' : 'patient';

  return {
    building_id: primaryResidence.building_id,
    unit_name: primaryResidence.unit_name ?? null,
    building_patient_count: buildingPatientCount,
    unit_patient_count: unitPatientCount,
    assignment_scope: assignmentScope,
  };
}

export function monthLabel(value: Date) {
  return value.toISOString().slice(0, 7);
}

function blockerDefinition(
  key: BillingEvidenceBlocker['key'],
  fallbackReason?: string | null,
): BillingEvidenceBlocker {
  switch (key) {
    case 'missing_visit_consent':
      return {
        key,
        reason: fallbackReason ?? '訪問薬剤管理の有効同意がありません',
        action_href: '/workflow',
        action_label: '同意状況を確認',
        severity: 'urgent',
      };
    case 'missing_management_plan':
      return {
        key,
        reason: fallbackReason ?? '承認済み管理計画書がありません',
        action_href: '/patients',
        action_label: '計画書を確認',
        severity: 'high',
      };
    case 'management_plan_review_overdue':
      return {
        key,
        reason: fallbackReason ?? '管理計画書の見直し期限を超過しています',
        action_href: '/workflow',
        action_label: '計画見直しを確認',
        severity: 'high',
      };
    case 'initial_home_visit_assessment_missing':
      return {
        key,
        reason:
          fallbackReason ?? '初回算定月のため、初回訪問前日までの患家訪問・環境聴取記録が必要です',
        action_href: '/patients',
        action_label: '患者記録を確認',
        severity: 'urgent',
      };
    case 'report_delivery_incomplete':
      return {
        key,
        reason: fallbackReason ?? '報告書送付が未完了です',
        action_href: '/reports',
        action_label: '送達状況を確認',
        severity: 'normal',
      };
    case 'outcome_not_claimable':
    default:
      return {
        key,
        reason: fallbackReason ?? '訪問結果が算定対象外です',
        action_href: '/visits',
        action_label: '訪問結果を確認',
        severity: 'normal',
      };
  }
}

function listBlockerKeys(
  flags: Prisma.JsonValue | null | undefined,
): BillingEvidenceBlocker['key'][] {
  if (!isRecord(flags)) return [];

  const orderedKeys: BillingEvidenceBlocker['key'][] = [
    'missing_visit_consent',
    'missing_management_plan',
    'management_plan_review_overdue',
    'initial_home_visit_assessment_missing',
    'report_delivery_incomplete',
    'outcome_not_claimable',
  ];

  return orderedKeys.filter((key) => flags[key] === true);
}

export function describeBillingEvidenceBlockers(args: {
  claimable: boolean;
  exclusionReason?: string | null;
  sameMonthExclusionFlags?: Prisma.JsonValue | null;
}): BillingEvidenceBlocker[] {
  if (args.claimable) return [];

  const keys = listBlockerKeys(args.sameMonthExclusionFlags);
  if (keys.length === 0) {
    return [
      {
        key: 'outcome_not_claimable',
        reason: args.exclusionReason ?? '算定条件の再確認が必要です',
        action_href: '/billing',
        action_label: '算定条件を確認',
        severity: 'normal',
      },
    ];
  }

  return keys.map((key, index) =>
    blockerDefinition(key, index === 0 ? args.exclusionReason : null),
  );
}

export async function listBillingEvidenceBlockers(
  tx: Tx,
  args: {
    orgId: string;
    patientId?: string;
    visitRecordId?: string;
    visitRecordIds?: string[];
    cycleIds?: string[];
    limit?: number;
  },
) {
  const evidenceList = await tx.billingEvidence.findMany({
    where: {
      org_id: args.orgId,
      claimable: false,
      ...(args.patientId ? { patient_id: args.patientId } : {}),
      ...(args.visitRecordId ? { visit_record_id: args.visitRecordId } : {}),
      ...(args.visitRecordIds || args.cycleIds
        ? {
            OR: [
              ...(args.visitRecordIds ? [{ visit_record_id: { in: args.visitRecordIds } }] : []),
              ...(args.cycleIds ? [{ cycle_id: { in: args.cycleIds } }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ billing_month: 'desc' }, { updated_at: 'desc' }],
    take: args.limit ?? 4,
    select: {
      id: true,
      visit_record_id: true,
      claimable: true,
      exclusion_reason: true,
      same_month_exclusion_flags: true,
      validation_notes: true,
    },
  });

  return evidenceList.map((evidence) => ({
    id: evidence.id,
    visit_record_id: evidence.visit_record_id,
    validation_notes: evidence.validation_notes,
    blockers: describeBillingEvidenceBlockers({
      claimable: evidence.claimable,
      exclusionReason: evidence.exclusion_reason,
      sameMonthExclusionFlags: evidence.same_month_exclusion_flags,
    }),
  }));
}

export function asRecord(value: Prisma.JsonValue | null | undefined) {
  return isRecord(value) ? value : {};
}

export async function upsertBillingEvidenceForVisit(
  tx: Tx,
  args: { orgId: string; visitRecordId: string },
) {
  const visitRecord = await tx.visitRecord.findFirst({
    where: {
      id: args.visitRecordId,
      org_id: args.orgId,
    },
    include: {
      schedule: {
        select: {
          cycle_id: true,
          case_id: true,
          pharmacist_id: true,
          visit_type: true,
          site_id: true,
        },
      },
    },
  });

  if (!visitRecord || !visitRecord.schedule) {
    throw new Error('VISIT_RECORD_NOT_FOUND');
  }

  const patient = await tx.patient.findFirst({
    where: {
      id: visitRecord.patient_id,
      org_id: args.orgId,
    },
    select: {
      id: true,
      birth_date: true,
      cases: {
        where: { id: visitRecord.schedule.case_id },
        select: {
          required_visit_support: true,
        },
        take: 1,
      },
    },
  });
  if (!patient) {
    throw new Error('PATIENT_NOT_FOUND');
  }

  const [medicalInsurance, careInsurance] = await Promise.all([
    resolvePatientInsurance(tx as Parameters<typeof resolvePatientInsurance>[0], {
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
      type: 'medical',
      asOf: visitRecord.visit_date,
    }),
    resolvePatientInsurance(tx as Parameters<typeof resolvePatientInsurance>[0], {
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
      type: 'care',
      asOf: visitRecord.visit_date,
    }),
  ]);

  const visitDate = visitRecord.visit_date;
  const visitDateOnly = new Date(
    Date.UTC(visitDate.getUTCFullYear(), visitDate.getUTCMonth(), visitDate.getUTCDate()),
  );
  const billingMonth = billingMonthForJapanTimestamp(visitRecord.visit_date);
  const billingMonthRange = japanMonthRangeForBillingMonth(billingMonth);
  const weekStart = startOfWeek(visitRecord.visit_date);
  const weekEnd = endOfWeek(weekStart);
  const primaryResidence = await fetchPrimaryResidenceForBilling(tx, {
    orgId: args.orgId,
    patientId: visitRecord.patient_id,
  });
  const [
    consent,
    plan,
    monthlyVisitCount,
    weeklyVisitCount,
    buildingPatientCount,
    billingAssignment,
    reports,
    deliveryRecords,
    initialHomeVisitAssessment,
    conferenceCandidates,
    latestPrescriptionIntake,
    businessHoliday,
    jahisSupplementalRecords,
  ] = await Promise.all([
    findActiveVisitConsent(tx, {
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
      asOf: visitRecord.visit_date,
    }),
    findCurrentManagementPlan(tx, {
      orgId: args.orgId,
      caseId: visitRecord.schedule.case_id,
      asOf: visitRecord.visit_date,
    }),
    tx.visitRecord.count({
      where: {
        org_id: args.orgId,
        patient_id: visitRecord.patient_id,
        visit_date: {
          gte: billingMonthRange.start,
          lt: billingMonthRange.nextStart,
        },
        outcome_status: {
          in: ['completed', 'completed_with_issue', 'revisit_needed', 'delivery_only'],
        },
      },
    }),
    tx.visitRecord.count({
      where: {
        org_id: args.orgId,
        schedule: {
          pharmacist_id: visitRecord.schedule.pharmacist_id,
        },
        visit_date: {
          gte: weekStart,
          lte: weekEnd,
        },
        outcome_status: {
          in: ['completed', 'completed_with_issue', 'revisit_needed', 'delivery_only'],
        },
      },
    }),
    resolveBuildingPatientCount(
      tx,
      {
        orgId: args.orgId,
        patientId: visitRecord.patient_id,
      },
      primaryResidence,
    ),
    resolveBillingAssignment(
      tx,
      {
        orgId: args.orgId,
        patientId: visitRecord.patient_id,
      },
      primaryResidence,
    ),
    tx.careReport.findMany({
      where: {
        org_id: args.orgId,
        visit_record_id: visitRecord.id,
      },
      select: {
        id: true,
        status: true,
      },
    }),
    tx.deliveryRecord.findMany({
      where: {
        org_id: args.orgId,
        report: {
          visit_record_id: visitRecord.id,
        },
      },
      select: {
        id: true,
        status: true,
      },
    }),
    evaluateInitialHomeVisitAssessmentRequirement(tx, {
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
      targetDate: visitRecord.visit_date,
    }),
    tx.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        patient_id: visitRecord.patient_id,
        billing_month: billingMonth,
      },
      select: {
        billing_code: true,
        status: true,
        source_snapshot: true,
      },
    }),
    visitRecord.schedule.cycle_id
      ? findLatestPrescriptionIntakeClassification(tx, {
          orgId: args.orgId,
          cycleId: visitRecord.schedule.cycle_id,
        })
      : Promise.resolve(null),
    tx.businessHoliday.findFirst({
      where: {
        org_id: args.orgId,
        date: visitDateOnly,
        OR: [{ site_id: null }, { site_id: visitRecord.schedule.site_id ?? null }],
      },
      select: { id: true },
    }),
    listJahisSupplementalRecordsForBilling(tx, {
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
    }),
  ]);

  const conferenceLinkages = conferenceCandidates
    .map((candidate) => ({
      ...candidate,
      linkage: readConferenceCandidateLinkage(candidate.source_snapshot),
    }))
    .filter(
      (candidate): candidate is typeof candidate & { linkage: { conferenceNoteId: string } } =>
        Boolean(candidate.linkage),
    );
  const conferenceNoteIds = Array.from(
    new Set(conferenceLinkages.map((candidate) => candidate.linkage.conferenceNoteId)),
  );
  const conferenceNotes =
    conferenceNoteIds.length > 0
      ? await tx.conferenceNote.findMany({
          where: {
            org_id: args.orgId,
            id: {
              in: conferenceNoteIds,
            },
          },
          select: {
            id: true,
            metadata: true,
            generated_report_id: true,
          },
        })
      : [];
  const conferenceGeneratedReportIds = Array.from(
    new Set(
      conferenceNotes
        .map(
          (note) =>
            note.generated_report_id ??
            (isRecord(note.metadata) && typeof note.metadata.generated_report_id === 'string'
              ? note.metadata.generated_report_id
              : null),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const [conferenceReports, conferenceDeliveryRecords] =
    conferenceGeneratedReportIds.length > 0
      ? await Promise.all([
          tx.careReport.findMany({
            where: {
              org_id: args.orgId,
              id: {
                in: conferenceGeneratedReportIds,
              },
            },
            select: {
              id: true,
              status: true,
            },
          }),
          tx.deliveryRecord.findMany({
            where: {
              org_id: args.orgId,
              report_id: {
                in: conferenceGeneratedReportIds,
              },
            },
            select: {
              id: true,
              report_id: true,
              status: true,
            },
          }),
        ])
      : [[], []];
  const conferenceRecommendedRuleKeys = Array.from(
    new Set(
      conferenceLinkages
        .filter((candidate) => candidate.status !== 'excluded')
        .map((candidate) => CONFERENCE_BILLING_RULE_KEYS[candidate.billing_code])
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const payerBasis = resolveBillingPayerBasis({
    medicalInsuranceNumber: medicalInsurance?.number ?? null,
    careInsuranceNumber: careInsurance?.number ?? null,
    visitType: visitRecord.schedule.visit_type,
  });
  const hasVisitReports = reports.length > 0;
  const hasConferenceReports = conferenceReports.length > 0;
  const allReportsDelivered =
    (hasVisitReports || hasConferenceReports) &&
    (!hasVisitReports ||
      areReportsDelivered({
        reports,
        deliveryRecords,
      })) &&
    (!hasConferenceReports ||
      areReportsDelivered({
        reports: conferenceReports,
        deliveryRecords: conferenceDeliveryRecords,
        expectedReportCount: conferenceGeneratedReportIds.length,
      }));

  const exclusionFlags = {
    missing_visit_consent: !consent,
    missing_management_plan: !plan.current,
    management_plan_review_overdue: plan.reviewOverdue,
    initial_home_visit_assessment_missing:
      initialHomeVisitAssessment.required && !initialHomeVisitAssessment.satisfied,
    report_delivery_incomplete: !allReportsDelivered,
    outcome_not_claimable: !isClaimableOutcome(visitRecord.outcome_status),
    building_patient_count: buildingPatientCount,
    monthly_visit_count: monthlyVisitCount,
    weekly_visit_count: weeklyVisitCount,
  };

  const exclusionReason = exclusionFlags.missing_visit_consent
    ? '訪問薬剤管理の有効同意がありません'
    : exclusionFlags.missing_management_plan
      ? '承認済み管理計画書がありません'
      : exclusionFlags.management_plan_review_overdue
        ? '管理計画書の見直し期限を超過しています'
        : exclusionFlags.initial_home_visit_assessment_missing
          ? '初回算定月のため、初回訪問前日までの患家訪問・環境聴取記録が必要です'
          : exclusionFlags.report_delivery_incomplete
            ? '報告書送付が未完了です'
            : exclusionFlags.outcome_not_claimable
              ? '訪問結果が算定対象外です'
              : null;

  const claimable = exclusionReason == null;

  // ── 患者データからの算定条件自動判定 ──

  const infantEligible = patient.birth_date
    ? isUnderAge(new Date(patient.birth_date), visitDate, 6)
    : false;

  // 小児特定加算判定 (18歳未満 — 障害児判定は手動のため候補提示のみ)
  const pediatricAge = patient.birth_date
    ? isUnderAge(new Date(patient.birth_date), visitDate, 18)
    : false;

  // 介護認定レベル判定 (intake の care_level から)
  const caseData = patient.cases?.[0] ?? null;
  const intakeJson = (caseData?.required_visit_support as Record<string, unknown> | null)
    ?.home_visit_intake as Record<string, unknown> | null;
  const careLevel = (intakeJson?.care_level as string) ?? null;
  const careLevelCategory = careLevel
    ? careLevel.startsWith('support_')
      ? ('support_required' as const)
      : careLevel.startsWith('care_')
        ? ('care_required' as const)
        : null
    : null;

  // 麻薬関連フラグ (intake から)
  const narcoticsBase = intakeJson?.narcotics_base === true;
  const narcoticsRescue = intakeJson?.narcotics_rescue === true;
  const narcoticRequired = narcoticsBase || narcoticsRescue;

  // 特別な医療処置 (intake から)
  const specialProcedures = Array.isArray(intakeJson?.special_medical_procedures)
    ? (intakeJson.special_medical_procedures as string[])
    : [];
  const centralVenousRequired = specialProcedures.some(
    (p) => p === 'tpn' || p === 'cv_port' || p === 'central_venous',
  );
  const narcoticInjectionRequired =
    specialProcedures.includes('narcotics') || specialProcedures.includes('narcotics_injection');
  const enteralRequired =
    specialProcedures.includes('enteral_nutrition') ||
    specialProcedures.includes('enteral_route') ||
    specialProcedures.includes('tube_feeding') ||
    (Array.isArray(intakeJson?.medication_support_methods) &&
      (intakeJson.medication_support_methods as string[]).includes('tube'));
  const structuredSoap =
    isRecord(visitRecord.structured_soap) && !Array.isArray(visitRecord.structured_soap)
      ? (visitRecord.structured_soap as Partial<StructuredSoap>)
      : null;
  const homeVisit2026Eligibility = getHomeVisit2026BillingEligibility(structuredSoap);

  // 特別上限対象 (末期悪性腫瘍 OR 麻薬注射 OR 中心静脈栄養)
  const terminalPainRequired = specialProcedures.includes('terminal_pain');
  const specialCapEligible =
    narcoticInjectionRequired || centralVenousRequired || terminalPainRequired;
  const emergencyCategory =
    latestPrescriptionIntake?.prescription_category === 'emergency'
      ? ((latestPrescriptionIntake.emergency_category as
          | 'planned_disease_exacerbation'
          | 'other_exacerbation'
          | 'online'
          | null) ?? 'other_exacerbation')
      : null;
  const afterHoursVisit = resolveAfterHoursVisitCategory({
    visitDate,
    isHoliday: businessHoliday != null || visitDate.getDay() === 0,
  });

  await ensureHomeCareBillingSsot(tx, args.orgId, { asOfDate: visitDate });

  const billingServiceType = payerBasis === 'care' ? 'care_home_management' : 'medical_home_visit';
  const providerScope = 'pharmacy';
  const siteId = visitRecord.schedule.site_id;
  const runtimeContext = await resolveBillingRuntimeContext(tx, {
    orgId: args.orgId,
    payerBasis: payerBasis === 'care' ? 'care' : 'medical',
    asOfDate: visitDateOnly,
    siteId,
    buildingPatientCount,
  });
  const siteConfigRow =
    runtimeContext.siteConfigId == null
      ? null
      : {
          id: runtimeContext.siteConfigId,
          revision_code: runtimeContext.siteConfigRevisionCode,
        };
  const config = runtimeContext.siteConfig;
  const regionAddOnEligible: Array<'special_15' | 'small_office_10' | 'resident_5'> = [];
  if (payerBasis === 'care') {
    if (config.region_special_15) regionAddOnEligible.push('special_15');
    if (config.region_small_office_10) regionAddOnEligible.push('small_office_10');
    if (config.region_resident_5) regionAddOnEligible.push('resident_5');
  }
  const candidateSpecs = await buildBillingCandidateSpecs(tx, {
    orgId: args.orgId,
    asOfDate: visitDate,
    payerBasis,
    serviceType: billingServiceType,
    providerScope,
    buildingPatientCount,
    monthlyVisitCount,
    weeklyVisitCount,
    claimable,
    exclusionReason,
    specialCapEligible,
    onlineEligible: emergencyCategory === 'online',
    regionAddOnEligible,
    visitType: visitRecord.schedule.visit_type,
    emergencyCategory,
    afterHoursVisit,
    // 自動判定された患者条件
    infantEligible,
    pediatricAge,
    narcoticRequired,
    narcoticInjectionRequired,
    centralVenousRequired,
    enteralRequired,
    careLevelCategory,
    initialTransitionEligible: homeVisit2026Eligibility.initialTransitionEligible,
    multiStaffVisitEligible: homeVisit2026Eligibility.multiStaffVisitEligible,
    physicianSimultaneousEligible: homeVisit2026Eligibility.physicianSimultaneousEligible,
  });

  // ── 薬局情報から体制加算を判定 ──
  if (siteId && siteConfigRow) {
    if (payerBasis === 'medical' && runtimeContext.homeComprehensive) {
      candidateSpecs.push({
        ssotKey: runtimeContext.homeComprehensive.ssotKey ?? 'site.medical.home_comprehensive_1',
        code: runtimeContext.homeComprehensive.code ?? 'MED_ADD_HOME_COMPREHENSIVE_1',
        name: runtimeContext.homeComprehensive.name ?? '在宅薬学総合体制加算1',
        status: claimable ? 'confirmed' : 'excluded',
        points: runtimeContext.homeComprehensive.points,
        exclusionReason: claimable ? null : (exclusionReason ?? null),
        calculationBreakdown: {
          source: 'pharmacy_site_insurance_config',
          site_id: siteId,
          building_tier: runtimeContext.homeComprehensive.buildingTier,
          site_config_status: runtimeContext.siteConfigStatus,
        },
        sourceSnapshot: {
          revision_code: runtimeContext.effectiveRevisionCode,
          site_config_revision_code: runtimeContext.siteConfigRevisionCode,
          level: runtimeContext.homeComprehensive.level,
          building_tier: runtimeContext.homeComprehensive.buildingTier,
        },
      });
    }
    /* Legacy branch retained for reference during runtime-context refactor.
    if (siteConfigRow && payerBasis === 'medical' && false) {
      // 在宅薬学総合体制加算 (改定により点数が異なる)
      const homeLevel = config.home_comprehensive_level as string | undefined;
      const revisionCode = siteConfigRow.revision_code;

      if (revisionCode === '2026') {
        const normalizedHomeLevel = normalizeHomeComprehensiveLevel2026(homeLevel);
        const singleBuilding = buildingPatientCount <= 1;

        // 2026改定: 加算1=30点, 加算2は訪問時の建物区分で点数が分かれる
        if (normalizedHomeLevel === 'level_2') {
          candidateSpecs.push({
            ssotKey: singleBuilding
              ? 'site.medical.home_comprehensive_2_i'
              : 'site.medical.home_comprehensive_2_ro',
            code: singleBuilding
              ? 'MED_ADD_HOME_COMPREHENSIVE_2_I'
              : 'MED_ADD_HOME_COMPREHENSIVE_2_RO',
            name: singleBuilding
              ? '在宅薬学総合体制加算2 イ（単一建物1人）'
              : '在宅薬学総合体制加算2 ロ（その他）',
            status: claimable ? 'confirmed' : 'excluded',
            points: singleBuilding ? 100 : 50,
            exclusionReason: claimable ? null : (exclusionReason ?? null),
            calculationBreakdown: {
              source: 'pharmacy_site_insurance_config',
              site_id: siteId,
              building_tier: buildingPatientCount <= 1 ? 'single' : 'other',
            },
            sourceSnapshot: {
              revision_code: revisionCode,
              level: normalizedHomeLevel,
              building_tier: buildingPatientCount <= 1 ? 'single' : 'other',
            },
          });
        } else if (normalizedHomeLevel === 'level_1') {
          candidateSpecs.push({
            ssotKey: 'site.medical.home_comprehensive_1',
            code: 'MED_ADD_HOME_COMPREHENSIVE_1',
            name: '在宅薬学総合体制加算1',
            status: claimable ? 'confirmed' : 'excluded',
            points: 30,
            exclusionReason: claimable ? null : (exclusionReason ?? null),
            calculationBreakdown: {
              source: 'pharmacy_site_insurance_config',
              site_id: siteId,
              building_tier: buildingPatientCount <= 1 ? 'single' : 'other',
            },
            sourceSnapshot: {
              revision_code: revisionCode,
              level: normalizedHomeLevel,
              building_tier: buildingPatientCount <= 1 ? 'single' : 'other',
            },
          });
        }
      } else {
        // 2024改定: 加算1=15点, 加算2=50点
        if (homeLevel === 'level_2') {
          candidateSpecs.push({
            ssotKey: 'site.medical.home_comprehensive_2',
            code: 'MED_ADD_HOME_COMPREHENSIVE_2',
            name: '在宅薬学総合体制加算2',
            status: claimable ? 'confirmed' : 'excluded',
            points: 50,
            exclusionReason: claimable ? null : (exclusionReason ?? null),
            calculationBreakdown: { source: 'pharmacy_site_insurance_config', site_id: siteId },
            sourceSnapshot: { revision_code: siteConfigRow.revision_code, level: homeLevel },
          });
        } else if (homeLevel === 'level_1') {
          candidateSpecs.push({
            ssotKey: 'site.medical.home_comprehensive_1',
            code: 'MED_ADD_HOME_COMPREHENSIVE_1',
            name: '在宅薬学総合体制加算1',
            status: claimable ? 'confirmed' : 'excluded',
            points: 15,
            exclusionReason: claimable ? null : (exclusionReason ?? null),
            calculationBreakdown: { source: 'pharmacy_site_insurance_config', site_id: siteId },
            sourceSnapshot: { revision_code: siteConfigRow.revision_code, level: homeLevel },
          });
        }
      }
    }
    */

    // 介護保険の地域加算を薬局情報から自動判定
    if (siteConfigRow && payerBasis === 'care') {
      if (regionAddOnEligible.length > 0) {
        for (const spec of candidateSpecs) {
          const cond = spec.calculationBreakdown as Record<string, unknown>;
          const regionKey = (cond.conditions as Record<string, unknown>)?.region_add_on;
          if (
            typeof regionKey === 'string' &&
            regionAddOnEligible.includes(
              regionKey as 'special_15' | 'small_office_10' | 'resident_5',
            )
          ) {
            if (spec.status === 'excluded' && claimable) {
              spec.status = 'candidate';
              spec.exclusionReason = 'SSOT上の追加算定候補です。要件確認後に採否を確定してください';
            }
          }
        }
      }
    }
  }

  const calculationContext: Prisma.InputJsonValue = {
    billing_service_type: billingServiceType,
    provider_scope: providerScope,
    effective_revision_code: runtimeContext.effectiveRevisionCode,
    effective_revision_label: runtimeContext.effectiveRevisionLabel,
    site_config_status: runtimeContext.siteConfigStatus,
    site_config_revision_code: runtimeContext.siteConfigRevisionCode,
    building_patient_count: buildingPatientCount,
    unit_patient_count: billingAssignment.unit_patient_count,
    building_id: billingAssignment.building_id,
    unit_name: billingAssignment.unit_name,
    assignment_scope: billingAssignment.assignment_scope,
    monthly_visit_count: monthlyVisitCount,
    weekly_visit_count: weeklyVisitCount,
    special_cap_eligible: specialCapEligible,
    online_eligible: emergencyCategory === 'online',
    region_add_on_eligible: regionAddOnEligible,
    visit_type: visitRecord.schedule.visit_type,
    emergency_category: emergencyCategory,
    after_hours_visit: afterHoursVisit,
    infant_eligible: infantEligible,
    pediatric_age: pediatricAge,
    narcotic_required: narcoticRequired,
    narcotic_injection_required: narcoticInjectionRequired,
    central_venous_required: centralVenousRequired,
    enteral_required: enteralRequired,
    care_level_category: careLevelCategory,
    initial_transition_eligible: homeVisit2026Eligibility.initialTransitionEligible,
    multi_staff_visit_eligible: homeVisit2026Eligibility.multiStaffVisitEligible,
    physician_simultaneous_eligible: homeVisit2026Eligibility.physicianSimultaneousEligible,
    jahis_supplemental_record_count: jahisSupplementalRecords.length,
    jahis_supplemental_record_types: Array.from(
      new Set(jahisSupplementalRecords.map((record) => record.record_type)),
    ),
    jahis_residual_confirmation_count: jahisSupplementalRecords.filter(
      (record) => record.record_type === '421',
    ).length,
    jahis_patient_note_count: jahisSupplementalRecords.filter(
      (record) => record.record_type === '4' || record.record_type === '601',
    ).length,
    runtime_warnings: runtimeContext.warnings,
  };

  const sharedReportDeliveryRef = csvFromUnique([
    ...deliveryRecords.map((record) => record.id),
    ...conferenceDeliveryRecords.map((record) => record.id),
  ]);

  const sharedAppliedRuleKeys = candidateSpecs
    .filter((spec) => spec.status === 'confirmed')
    .map((spec) => spec.ssotKey) as Prisma.InputJsonValue;

  const sharedRecommendedRuleKeys = Array.from(
    new Set([
      ...candidateSpecs.filter((spec) => spec.status === 'candidate').map((spec) => spec.ssotKey),
      ...conferenceRecommendedRuleKeys,
    ]),
  ) as Prisma.InputJsonValue;

  const sharedValidationNotes = claimable
    ? '同意・管理計画書・報告送付を満たしています'
    : exclusionReason;

  const evidence = await tx.billingEvidence.upsert({
    where: {
      org_id_visit_record_id: {
        org_id: args.orgId,
        visit_record_id: visitRecord.id,
      },
    },
    create: {
      org_id: args.orgId,
      visit_record_id: visitRecord.id,
      patient_id: visitRecord.patient_id,
      cycle_id: visitRecord.schedule.cycle_id,
      billing_month: billingMonth,
      payer_basis: payerBasis,
      billing_service_type: billingServiceType,
      provider_scope: providerScope,
      claimable,
      exclusion_reason: exclusionReason,
      consent_ref: consent?.id ?? null,
      management_plan_ref: plan.current?.id ?? null,
      report_delivery_ref: sharedReportDeliveryRef,
      conference_note_ref: csvFromUnique(conferenceNoteIds),
      visit_record_ref: visitRecord.id,
      building_patient_count: buildingPatientCount,
      monthly_count_snapshot: monthlyVisitCount,
      weekly_count_snapshot: weeklyVisitCount,
      applied_rule_keys: sharedAppliedRuleKeys,
      recommended_rule_keys: sharedRecommendedRuleKeys,
      calculation_context: calculationContext,
      same_month_exclusion_flags: exclusionFlags as Prisma.InputJsonValue,
      validation_notes: sharedValidationNotes,
    },
    update: {
      patient_id: visitRecord.patient_id,
      cycle_id: visitRecord.schedule.cycle_id,
      billing_month: billingMonth,
      payer_basis: payerBasis,
      billing_service_type: billingServiceType,
      provider_scope: providerScope,
      claimable,
      exclusion_reason: exclusionReason,
      consent_ref: consent?.id ?? null,
      management_plan_ref: plan.current?.id ?? null,
      report_delivery_ref: sharedReportDeliveryRef,
      conference_note_ref: csvFromUnique(conferenceNoteIds),
      visit_record_ref: visitRecord.id,
      building_patient_count: buildingPatientCount,
      monthly_count_snapshot: monthlyVisitCount,
      weekly_count_snapshot: weeklyVisitCount,
      applied_rule_keys: sharedAppliedRuleKeys,
      recommended_rule_keys: sharedRecommendedRuleKeys,
      calculation_context: calculationContext,
      same_month_exclusion_flags: exclusionFlags as Prisma.InputJsonValue,
      validation_notes: sharedValidationNotes,
    },
  });

  const taskKey = buildBillingTaskKey(visitRecord.id);
  if (claimable) {
    await resolveOperationalTasks(tx, {
      orgId: args.orgId,
      dedupeKey: taskKey,
      status: 'completed',
    });
  } else {
    await upsertOperationalTask(tx, {
      orgId: args.orgId,
      taskType: 'billing_evidence_review',
      title: '請求根拠の確認が必要です',
      description: exclusionReason,
      priority: 'high',
      assignedTo: visitRecord.schedule.pharmacist_id,
      dueDate: visitRecord.visit_date,
      slaDueAt: visitRecord.visit_date,
      relatedEntityType: 'visit_record',
      relatedEntityId: visitRecord.id,
      dedupeKey: taskKey,
      metadata: {
        visit_record_id: visitRecord.id,
        patient_id: visitRecord.patient_id,
        cycle_id: visitRecord.schedule.cycle_id,
      } as Prisma.InputJsonValue,
    });
  }

  return evidence;
}

export async function getBillingCandidateWorkbenchSummary(
  tx: Tx,
  args: { orgId: string; billingMonth: Date; patientId?: string },
) {
  const billingMonth = startOfMonth(args.billingMonth);
  const [candidates, blockedEvidences] = await Promise.all([
    tx.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        billing_month: billingMonth,
        ...(args.patientId ? { patient_id: args.patientId } : {}),
      },
      select: {
        status: true,
        source_snapshot: true,
        exclusion_reason: true,
      },
      orderBy: [{ created_at: 'asc' }],
    }),
    tx.billingEvidence.findMany({
      where: {
        org_id: args.orgId,
        billing_month: billingMonth,
        ...(args.patientId ? { patient_id: args.patientId } : {}),
        claimable: false,
      },
      select: {
        exclusion_reason: true,
      },
      orderBy: [{ created_at: 'asc' }],
    }),
  ]);

  const summary = {
    total: candidates.length,
    pending_review: 0,
    confirmed: 0,
    excluded: 0,
    exported: 0,
    reviewed: 0,
    ready_to_close: 0,
    blocked_from_close: 0,
    blocker_reasons: [] as Array<{ reason: string; count: number }>,
  };

  const blockerReasons = new Map<string, number>();

  for (const candidate of candidates) {
    const workflow = readBillingCandidateWorkflowState(candidate.source_snapshot);
    if (workflow.review_state === 'reviewed') {
      summary.reviewed += 1;
    }

    switch (candidate.status) {
      case 'confirmed':
        summary.confirmed += 1;
        summary.ready_to_close += 1;
        break;
      case 'excluded':
        summary.excluded += 1;
        break;
      case 'exported':
        summary.exported += 1;
        break;
      default:
        summary.pending_review += 1;
        summary.blocked_from_close += 1;
        if (candidate.exclusion_reason) {
          blockerReasons.set(
            candidate.exclusion_reason,
            (blockerReasons.get(candidate.exclusion_reason) ?? 0) + 1,
          );
        }
        break;
    }
  }

  for (const evidence of blockedEvidences) {
    summary.blocked_from_close += 1;
    if (evidence.exclusion_reason) {
      blockerReasons.set(
        evidence.exclusion_reason,
        (blockerReasons.get(evidence.exclusion_reason) ?? 0) + 1,
      );
    }
  }

  summary.blocker_reasons = Array.from(blockerReasons.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort(
      (left, right) => right.count - left.count || left.reason.localeCompare(right.reason, 'ja'),
    )
    .slice(0, 5);

  return summary;
}

export async function reviewBillingCandidate(
  tx: Tx,
  args: {
    orgId: string;
    billingCandidateId: string;
    action: 'confirm' | 'exclude' | 'reopen';
    note?: string | null;
    actorId: string;
  },
) {
  const candidate = await tx.billingCandidate.findFirst({
    where: {
      id: args.billingCandidateId,
      org_id: args.orgId,
    },
  });

  if (!candidate) {
    throw new Error('BILLING_CANDIDATE_NOT_FOUND');
  }
  if (candidate.status === 'exported') {
    throw new Error('BILLING_CANDIDATE_CLOSED');
  }

  const reviewedAt = new Date();
  const nextStatus =
    args.action === 'confirm' ? 'confirmed' : args.action === 'exclude' ? 'excluded' : 'candidate';
  const nextWorkflow =
    args.action === 'reopen'
      ? {
          review_state: 'pending' as const,
          resolution_state: 'unresolved' as const,
          reviewed_at: null,
          reviewed_by: null,
          closed_at: null,
          closed_by: null,
          note: args.note ?? null,
        }
      : {
          review_state: 'reviewed' as const,
          resolution_state:
            args.action === 'confirm' ? ('confirmed' as const) : ('excluded' as const),
          reviewed_at: reviewedAt.toISOString(),
          reviewed_by: args.actorId,
          closed_at: null,
          closed_by: null,
          note:
            args.note ?? (args.action === 'exclude' ? (candidate.exclusion_reason ?? null) : null),
        };

  return tx.billingCandidate.update({
    where: { id: candidate.id },
    data: {
      status: nextStatus,
      source_snapshot: writeBillingCandidateWorkflowState(candidate.source_snapshot, nextWorkflow),
    },
  });
}

export async function closeBillingCandidatesForMonth(
  tx: Tx,
  args: {
    orgId: string;
    billingMonth: Date;
    actorId: string;
  },
) {
  const billingMonth = startOfMonth(args.billingMonth);
  const candidates = await tx.billingCandidate.findMany({
    where: {
      org_id: args.orgId,
      billing_month: billingMonth,
    },
    select: {
      id: true,
      status: true,
      source_snapshot: true,
    },
  });

  const pendingReview = candidates.filter((candidate) => candidate.status === 'candidate');
  const blockedEvidenceCount = await tx.billingEvidence.count({
    where: {
      org_id: args.orgId,
      billing_month: billingMonth,
      claimable: false,
    },
  });
  if (pendingReview.length > 0 || blockedEvidenceCount > 0) {
    return {
      blocked: true,
      summary: await getBillingCandidateWorkbenchSummary(tx, {
        orgId: args.orgId,
        billingMonth,
      }),
      blockingCount: pendingReview.length + blockedEvidenceCount,
    };
  }

  const closedAt = new Date();
  const exported = await Promise.all(
    candidates
      .filter((candidate) => candidate.status === 'confirmed')
      .map((candidate) =>
        tx.billingCandidate.update({
          where: { id: candidate.id },
          data: {
            status: 'exported',
            source_snapshot: writeBillingCandidateWorkflowState(candidate.source_snapshot, {
              review_state: 'reviewed',
              resolution_state: 'confirmed',
              closed_at: closedAt.toISOString(),
              closed_by: args.actorId,
              reviewed_at: readBillingCandidateWorkflowState(candidate.source_snapshot).reviewed_at,
              reviewed_by: readBillingCandidateWorkflowState(candidate.source_snapshot).reviewed_by,
            }),
          },
        }),
      ),
  );

  await tx.auditLog.create({
    data: {
      org_id: args.orgId,
      actor_id: args.actorId,
      action: 'billing_candidates_month_closed',
      target_type: 'BillingMonth',
      target_id: monthLabel(billingMonth),
      changes: {
        billing_month: billingMonth.toISOString(),
        exported_count: exported.length,
      },
    },
  });

  return {
    blocked: false,
    exported_count: exported.length,
    summary: await getBillingCandidateWorkbenchSummary(tx, {
      orgId: args.orgId,
      billingMonth,
    }),
  };
}
