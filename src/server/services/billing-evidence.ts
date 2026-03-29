import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { findActiveVisitConsent, findCurrentManagementPlan } from './management-plans';
import { upsertOperationalTask, resolveOperationalTasks } from './operational-tasks';
import {
  buildBillingCandidateSpecs,
  ensureHomeCareBillingSsot,
  HOME_CARE_BILLING_RULESET_VERSION,
} from './home-care-billing-ssot';

type Tx = Prisma.TransactionClient | typeof prisma;

type BillingCandidateWorkflowState = {
  review_state: 'pending' | 'reviewed';
  resolution_state: 'unresolved' | 'confirmed' | 'excluded';
  reviewed_at: string | null;
  reviewed_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  note: string | null;
};

type BillingValidationLayerState = 'passed' | 'manual_review' | 'blocked';

type BillingValidationLayer = {
  label: string;
  state: BillingValidationLayerState;
  message: string;
  version?: string;
};

type BillingValidationLayers = {
  evidence: BillingValidationLayer;
  rule_engine: BillingValidationLayer;
  close_review: BillingValidationLayer;
};

type AdditionalBillingRuleDefinition = {
  ssotKey: string;
  code: string;
  name: string;
  points: number;
  sourceNote: string;
  targetLabel: string;
};

type InformationProvisionFeeType =
  | '1'
  | '2_i'
  | '2_ro'
  | '2_ha'
  | '3';

type HomeDuplicateInteractionFeeType =
  | '1_i'
  | '1_ro'
  | '2_i'
  | '2_ro';

const INFORMATION_PROVISION_RULES: Record<
  InformationProvisionFeeType,
  AdditionalBillingRuleDefinition
> = {
  '1': {
    ssotKey: 'medical.information_provision.1',
    code: 'MED_INFO_PROVISION_1',
    name: '服薬情報等提供料1',
    points: 30,
    sourceNote: '調剤報酬点数表 区分15の5 服薬情報等提供料1',
    targetLabel: '医療機関依頼',
  },
  '2_i': {
    ssotKey: 'medical.information_provision.2_medical',
    code: 'MED_INFO_PROVISION_2_I',
    name: '服薬情報等提供料2 イ',
    points: 20,
    sourceNote: '調剤報酬点数表 区分15の5 服薬情報等提供料2 イ',
    targetLabel: '医療機関共有',
  },
  '2_ro': {
    ssotKey: 'medical.information_provision.2_refill',
    code: 'MED_INFO_PROVISION_2_RO',
    name: '服薬情報等提供料2 ロ',
    points: 20,
    sourceNote: '調剤報酬点数表 区分15の5 服薬情報等提供料2 ロ',
    targetLabel: 'リフィル共有',
  },
  '2_ha': {
    ssotKey: 'medical.information_provision.2_care_manager',
    code: 'MED_INFO_PROVISION_2_HA',
    name: '服薬情報等提供料2 ハ',
    points: 20,
    sourceNote: '調剤報酬点数表 区分15の5 服薬情報等提供料2 ハ',
    targetLabel: 'ケアマネ共有',
  },
  '3': {
    ssotKey: 'medical.information_provision.3',
    code: 'MED_INFO_PROVISION_3',
    name: '服薬情報等提供料3',
    points: 50,
    sourceNote: '調剤報酬点数表 区分15の5 服薬情報等提供料3',
    targetLabel: '入院前整理',
  },
};

const HOME_DUPLICATE_INTERACTION_RULES: Record<
  HomeDuplicateInteractionFeeType,
  AdditionalBillingRuleDefinition
> = {
  '1_i': {
    ssotKey: 'medical.home_duplicate_interaction.change_other',
    code: 'MED_HOME_DUPLICATE_CHANGE_OTHER',
    name: '在宅患者重複投薬・相互作用等防止管理料1 イ',
    points: 40,
    sourceNote: '調剤報酬点数表 区分15の6 在宅患者重複投薬・相互作用等防止管理料1 イ',
    targetLabel: '照会後変更',
  },
  '1_ro': {
    ssotKey: 'medical.home_duplicate_interaction.change_residual',
    code: 'MED_HOME_DUPLICATE_CHANGE_RESIDUAL',
    name: '在宅患者重複投薬・相互作用等防止管理料1 ロ',
    points: 20,
    sourceNote: '調剤報酬点数表 区分15の6 在宅患者重複投薬・相互作用等防止管理料1 ロ',
    targetLabel: '残薬照会後変更',
  },
  '2_i': {
    ssotKey: 'medical.home_duplicate_interaction.proposal_other',
    code: 'MED_HOME_DUPLICATE_PROPOSAL_OTHER',
    name: '在宅患者重複投薬・相互作用等防止管理料2 イ',
    points: 40,
    sourceNote: '調剤報酬点数表 区分15の6 在宅患者重複投薬・相互作用等防止管理料2 イ',
    targetLabel: '事前提案反映',
  },
  '2_ro': {
    ssotKey: 'medical.home_duplicate_interaction.proposal_residual',
    code: 'MED_HOME_DUPLICATE_PROPOSAL_RESIDUAL',
    name: '在宅患者重複投薬・相互作用等防止管理料2 ロ',
    points: 20,
    sourceNote: '調剤報酬点数表 区分15の6 在宅患者重複投薬・相互作用等防止管理料2 ロ',
    targetLabel: '残薬事前提案反映',
  },
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

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function endOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999);
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

/**
 * Determine the payer basis (insurance type) for billing.
 *
 * Rules (令和6年度):
 * - 介護認定あり (care_insurance_number exists) → 介護保険 (care)
 * - 介護認定なし → 医療保険 (medical)
 * - 緊急訪問 (visit_type === 'emergency') → 常に医療保険 (medical)
 *   ※ 在宅患者緊急訪問薬剤管理指導料は介護認定ありでも医療保険で算定
 * - 保険番号なし → 自費 (self_pay)
 */
function getPayerBasis(args: {
  medicalInsuranceNumber?: string | null;
  careInsuranceNumber?: string | null;
  visitType?: string | null;
}) {
  // 緊急訪問は介護認定の有無に関わらず医療保険で算定
  const isEmergencyVisit = args.visitType === 'emergency';

  if (isEmergencyVisit) {
    // 緊急訪問は常に医療保険（在宅患者緊急訪問薬剤管理指導料）
    if (args.medicalInsuranceNumber || args.careInsuranceNumber) {
      return 'medical' as const;
    }
    return 'self_pay' as const;
  }

  // 通常訪問: 介護認定あり → 介護保険優先
  if (args.careInsuranceNumber) return 'care' as const;
  if (args.medicalInsuranceNumber) return 'medical' as const;
  return 'self_pay' as const;
}

function buildBillingTaskKey(visitRecordId: string) {
  return `billing-evidence:${visitRecordId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      (value) => Array.isArray(value) && value.some((entry) => typeof entry === 'string' && entry.trim().length > 0)
    );

  return freeText.length > 0 || hasFunctionalAssessment;
}

export async function evaluateInitialHomeVisitAssessmentRequirement(
  tx: Tx,
  args: { orgId: string; patientId: string; targetDate: Date }
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
    initialVisitRecord != null &&
    hasInitialHomeVisitAssessmentEvidence(initialVisitRecord);

  return {
    required: true,
    satisfied,
    initialVisitRecordId: initialVisitRecord?.id ?? null,
    reason: satisfied
      ? null
      : '初回算定月のため、初回訪問前日までの患家訪問・環境聴取記録が必要です',
  };
}

function readBillingCandidateWorkflowState(
  sourceSnapshot: Prisma.JsonValue | null | undefined
): BillingCandidateWorkflowState {
  const workflow = isRecord(sourceSnapshot) && isRecord(sourceSnapshot.billing_close)
    ? sourceSnapshot.billing_close
    : {};

  return {
    review_state:
      workflow.review_state === 'reviewed' ? 'reviewed' : 'pending',
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

function writeBillingCandidateWorkflowState(
  sourceSnapshot: Prisma.JsonValue | null | undefined,
  workflow: Partial<BillingCandidateWorkflowState>
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

function buildValidationLayers(args: {
  evidencePassed: boolean;
  evidenceMessage: string;
  ruleMessage: string;
  candidateStatus: string;
  workflow: BillingCandidateWorkflowState;
}): BillingValidationLayers {
  const reviewState =
    args.candidateStatus === 'exported' || args.workflow.closed_at
      ? 'passed'
      : args.workflow.review_state === 'reviewed' &&
          args.workflow.resolution_state === 'confirmed'
        ? 'passed'
        : args.workflow.review_state === 'reviewed' &&
            args.workflow.resolution_state === 'excluded'
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

function mergeCandidateSourceSnapshot(args: {
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

async function resolveBuildingPatientCount(tx: Tx, args: { orgId: string; patientId: string }) {
  const primaryResidence = await tx.residence.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      is_primary: true,
    },
    select: {
      building_id: true,
    },
  });

  if (!primaryResidence?.building_id) return 1;

  return tx.residence.count({
    where: {
      org_id: args.orgId,
      building_id: primaryResidence.building_id,
      is_primary: true,
    },
  });
}

async function resolveBillingAssignment(tx: Tx, args: { orgId: string; patientId: string }) {
  const primaryResidence = await tx.residence.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      is_primary: true,
    },
    select: {
      building_id: true,
      unit_name: true,
    },
  });

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
    buildingPatientCount > 1
      ? 'building'
      : unitPatientCount > 1
        ? 'unit'
        : 'patient';

  return {
    building_id: primaryResidence.building_id,
    unit_name: primaryResidence.unit_name ?? null,
    building_patient_count: buildingPatientCount,
    unit_patient_count: unitPatientCount,
    assignment_scope: assignmentScope,
  };
}

function monthLabel(value: Date) {
  return value.toISOString().slice(0, 7);
}

function blockerDefinition(
  key: BillingEvidenceBlocker['key'],
  fallbackReason?: string | null
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
        reason: fallbackReason ?? '初回算定月のため、初回訪問前日までの患家訪問・環境聴取記録が必要です',
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
  flags: Prisma.JsonValue | null | undefined
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
    blockerDefinition(key, index === 0 ? args.exclusionReason : null)
  );
}

export async function listBillingEvidenceBlockers(
  tx: Tx,
  args: {
    orgId: string;
    patientId?: string;
    visitRecordId?: string;
    limit?: number;
  }
) {
  const evidenceList = await tx.billingEvidence.findMany({
    where: {
      org_id: args.orgId,
      claimable: false,
      ...(args.patientId ? { patient_id: args.patientId } : {}),
      ...(args.visitRecordId ? { visit_record_id: args.visitRecordId } : {}),
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

function asRecord(value: Prisma.JsonValue | null | undefined) {
  return isRecord(value) ? value : {};
}

function parseInformationProvisionFeeType(
  content: Prisma.JsonValue | null | undefined,
  fallbackType?: InformationProvisionFeeType
): InformationProvisionFeeType {
  const record = asRecord(content);
  const directType = record.billing_fee_type;
  if (
    directType === '1' ||
    directType === '2_i' ||
    directType === '2_ro' ||
    directType === '2_ha' ||
    directType === '3'
  ) {
    return directType;
  }

  const category = typeof record.category === 'string' ? record.category : null;
  const reportContext = typeof record.report_context === 'string' ? record.report_context : null;

  if (category === 'residual_reduction') return '2_i';
  if (reportContext === 'pre_admission' || category === 'pre_admission') return '3';
  return fallbackType ?? '2_i';
}

function parseHomeDuplicateInteractionFeeType(args: {
  reason: string;
  changeDetail?: string | null;
}): HomeDuplicateInteractionFeeType {
  const normalizedReason = args.reason.trim();
  const normalizedDetail = (args.changeDetail ?? '').trim().toLowerCase();
  const isResidual =
    normalizedReason.includes('残薬') || normalizedDetail.includes('residual');
  const isProposal =
    normalizedDetail.includes('proposal') ||
    normalizedDetail.includes('事前提案') ||
    normalizedDetail.includes('pre-issuance');

  if (isProposal) {
    return isResidual ? '2_ro' : '2_i';
  }
  return isResidual ? '1_ro' : '1_i';
}

async function generateInformationProvisionCandidates(
  tx: Tx,
  args: {
    orgId: string;
    billingMonth: Date;
    ruleIdByKey: Map<string, string>;
    existingByKey: Map<string, { source_snapshot: Prisma.JsonValue | null }>;
    claimableEvidenceByPatient: Map<string, { any: number; care: number }>;
  }
) {
  const monthStart = startOfMonth(args.billingMonth);
  const monthEnd = endOfMonth(args.billingMonth);

  const [tracingReports, careManagerReports] = await Promise.all([
    tx.tracingReport.findMany({
      where: {
        org_id: args.orgId,
        status: { in: ['sent', 'received', 'acknowledged'] },
        sent_at: { gte: monthStart, lte: monthEnd },
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        content: true,
        status: true,
        sent_at: true,
      },
    }),
    tx.careReport.findMany({
      where: {
        org_id: args.orgId,
        report_type: 'care_manager_report',
        status: { in: ['sent', 'confirmed'] },
        updated_at: { gte: monthStart, lte: monthEnd },
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        content: true,
        status: true,
        updated_at: true,
      },
    }),
  ]);

  const created = [];
  const claimedInfoTypes = new Set<string>();

  for (const report of tracingReports) {
    const feeType = parseInformationProvisionFeeType(report.content);
    const rule = INFORMATION_PROVISION_RULES[feeType];
    const claimableState = args.claimableEvidenceByPatient.get(report.patient_id) ?? {
      any: 0,
      care: 0,
    };
    const sameMonthHomeCareClaim = claimableState.any > 0;
    const sameMonthCareManagementClaim = claimableState.care > 0;
    const dedupeKey = `${monthLabel(monthStart)}:info:${report.id}:${feeType}`;
    const typeScopeKey = `${report.patient_id}:${feeType}`;
    const existing = args.existingByKey.get(dedupeKey);
    const existingWorkflow = readBillingCandidateWorkflowState(existing?.source_snapshot);
    const alreadyClaimedThisMonth = claimedInfoTypes.has(typeScopeKey);
    const exclusionReason =
      sameMonthHomeCareClaim
        ? '同月に在宅患者訪問薬剤管理指導料等を算定しているため服薬情報等提供料は算定できません'
        : feeType === '2_ha' && sameMonthCareManagementClaim
          ? '同月に居宅療養管理指導費を算定しているため服薬情報等提供料2 ハは算定できません'
          : alreadyClaimedThisMonth
            ? '同一月内に同種の服薬情報等提供料候補が既に存在します'
            : null;
    const status =
      exclusionReason != null
        ? 'excluded'
        : existingWorkflow.closed_at
          ? 'exported'
          : existingWorkflow.resolution_state === 'confirmed'
            ? 'confirmed'
            : existingWorkflow.resolution_state === 'excluded'
              ? 'excluded'
              : 'candidate';

    const candidate = await tx.billingCandidate.upsert({
      where: {
        org_id_dedupe_key: {
          org_id: args.orgId,
          dedupe_key: dedupeKey,
        },
      },
      create: {
        org_id: args.orgId,
        patient_id: report.patient_id,
        cycle_id: null,
        evidence_id: null,
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        dedupe_key: dedupeKey,
        billing_month: monthStart,
        billing_code: rule.code,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: {
          source_type: 'tracing_report',
          source_id: report.id,
          fee_type: feeType,
          target: rule.targetLabel,
          same_month_home_care_claim: sameMonthHomeCareClaim,
          same_month_care_management_claim: sameMonthCareManagementClaim,
        } as Prisma.InputJsonValue,
        source_snapshot: writeBillingCandidateWorkflowState(
          mergeCandidateSourceSnapshot({
            sourceSnapshot: {
              billing_scope: 'home_care_ssot',
              selection_mode: 'manual',
              source_note: rule.sourceNote,
              source_type: 'tracing_report',
              source_entity_id: report.id,
              billing_fee_type: feeType,
              ruleset_version: HOME_CARE_BILLING_RULESET_VERSION,
            },
            calculationContext: null,
            candidateStatus: status,
            claimable: exclusionReason == null,
            evidenceMessage:
              exclusionReason == null
                ? '同月の在宅請求との併算定制約なし'
                : exclusionReason,
            ruleMessage:
              exclusionReason == null
                ? `${rule.targetLabel} の情報提供候補`
                : exclusionReason,
            workflow: existingWorkflow,
          }) as Prisma.JsonValue,
          existingWorkflow
        ),
        status,
        exclusion_reason: exclusionReason,
      },
      update: {
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: {
          source_type: 'tracing_report',
          source_id: report.id,
          fee_type: feeType,
          target: rule.targetLabel,
          same_month_home_care_claim: sameMonthHomeCareClaim,
          same_month_care_management_claim: sameMonthCareManagementClaim,
        } as Prisma.InputJsonValue,
        source_snapshot: writeBillingCandidateWorkflowState(
          mergeCandidateSourceSnapshot({
            sourceSnapshot: {
              billing_scope: 'home_care_ssot',
              selection_mode: 'manual',
              source_note: rule.sourceNote,
              source_type: 'tracing_report',
              source_entity_id: report.id,
              billing_fee_type: feeType,
              ruleset_version: HOME_CARE_BILLING_RULESET_VERSION,
            },
            calculationContext: null,
            candidateStatus: status,
            claimable: exclusionReason == null,
            evidenceMessage:
              exclusionReason == null
                ? '同月の在宅請求との併算定制約なし'
                : exclusionReason,
            ruleMessage:
              exclusionReason == null
                ? `${rule.targetLabel} の情報提供候補`
                : exclusionReason,
            workflow: existingWorkflow,
          }) as Prisma.JsonValue,
          existingWorkflow
        ),
        status,
        exclusion_reason: exclusionReason,
      },
    });

    created.push(candidate);
    if (status !== 'excluded') {
      claimedInfoTypes.add(typeScopeKey);
    }
  }

  for (const report of careManagerReports) {
    const feeType = parseInformationProvisionFeeType(report.content, '2_ha');
    const rule = INFORMATION_PROVISION_RULES[feeType];
    const claimableState = args.claimableEvidenceByPatient.get(report.patient_id) ?? {
      any: 0,
      care: 0,
    };
    const sameMonthHomeCareClaim = claimableState.any > 0;
    const sameMonthCareManagementClaim = claimableState.care > 0;
    const dedupeKey = `${monthLabel(monthStart)}:info-care:${report.id}:${feeType}`;
    const typeScopeKey = `${report.patient_id}:${feeType}`;
    const existing = args.existingByKey.get(dedupeKey);
    const existingWorkflow = readBillingCandidateWorkflowState(existing?.source_snapshot);
    const alreadyClaimedThisMonth = claimedInfoTypes.has(typeScopeKey);
    const exclusionReason =
      sameMonthHomeCareClaim
        ? '同月に在宅患者訪問薬剤管理指導料等を算定しているため服薬情報等提供料は算定できません'
        : feeType === '2_ha' && sameMonthCareManagementClaim
          ? '同月に居宅療養管理指導費を算定しているため服薬情報等提供料2 ハは算定できません'
          : alreadyClaimedThisMonth
            ? '同一月内に同種の服薬情報等提供料候補が既に存在します'
            : null;
    const status =
      exclusionReason != null
        ? 'excluded'
        : existingWorkflow.closed_at
          ? 'exported'
          : existingWorkflow.resolution_state === 'confirmed'
            ? 'confirmed'
            : existingWorkflow.resolution_state === 'excluded'
              ? 'excluded'
              : 'candidate';

    const candidate = await tx.billingCandidate.upsert({
      where: {
        org_id_dedupe_key: {
          org_id: args.orgId,
          dedupe_key: dedupeKey,
        },
      },
      create: {
        org_id: args.orgId,
        patient_id: report.patient_id,
        cycle_id: null,
        evidence_id: null,
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        dedupe_key: dedupeKey,
        billing_month: monthStart,
        billing_code: rule.code,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: {
          source_type: 'care_report',
          source_id: report.id,
          fee_type: feeType,
          target: rule.targetLabel,
          same_month_home_care_claim: sameMonthHomeCareClaim,
          same_month_care_management_claim: sameMonthCareManagementClaim,
        } as Prisma.InputJsonValue,
        source_snapshot: writeBillingCandidateWorkflowState(
          mergeCandidateSourceSnapshot({
            sourceSnapshot: {
              billing_scope: 'home_care_ssot',
              selection_mode: 'manual',
              source_note: rule.sourceNote,
              source_type: 'care_report',
              source_entity_id: report.id,
              billing_fee_type: feeType,
              ruleset_version: HOME_CARE_BILLING_RULESET_VERSION,
            },
            calculationContext: null,
            candidateStatus: status,
            claimable: exclusionReason == null,
            evidenceMessage:
              exclusionReason == null
                ? '同月の在宅請求との併算定制約なし'
                : exclusionReason,
            ruleMessage:
              exclusionReason == null
                ? `${rule.targetLabel} の情報提供候補`
                : exclusionReason,
            workflow: existingWorkflow,
          }) as Prisma.JsonValue,
          existingWorkflow
        ),
        status,
        exclusion_reason: exclusionReason,
      },
      update: {
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: {
          source_type: 'care_report',
          source_id: report.id,
          fee_type: feeType,
          target: rule.targetLabel,
          same_month_home_care_claim: sameMonthHomeCareClaim,
          same_month_care_management_claim: sameMonthCareManagementClaim,
        } as Prisma.InputJsonValue,
        source_snapshot: writeBillingCandidateWorkflowState(
          mergeCandidateSourceSnapshot({
            sourceSnapshot: {
              billing_scope: 'home_care_ssot',
              selection_mode: 'manual',
              source_note: rule.sourceNote,
              source_type: 'care_report',
              source_entity_id: report.id,
              billing_fee_type: feeType,
              ruleset_version: HOME_CARE_BILLING_RULESET_VERSION,
            },
            calculationContext: null,
            candidateStatus: status,
            claimable: exclusionReason == null,
            evidenceMessage:
              exclusionReason == null
                ? '同月の在宅請求との併算定制約なし'
                : exclusionReason,
            ruleMessage:
              exclusionReason == null
                ? `${rule.targetLabel} の情報提供候補`
                : exclusionReason,
            workflow: existingWorkflow,
          }) as Prisma.JsonValue,
          existingWorkflow
        ),
        status,
        exclusion_reason: exclusionReason,
      },
    });

    created.push(candidate);
    if (status !== 'excluded') {
      claimedInfoTypes.add(typeScopeKey);
    }
  }

  return created;
}

async function generateHomeDuplicateInteractionCandidates(
  tx: Tx,
  args: {
    orgId: string;
    billingMonth: Date;
    ruleIdByKey: Map<string, string>;
    existingByKey: Map<string, { source_snapshot: Prisma.JsonValue | null }>;
  }
) {
  const monthStart = startOfMonth(args.billingMonth);
  const monthEnd = endOfMonth(args.billingMonth);
  const inquiries = await tx.inquiryRecord.findMany({
    where: {
      org_id: args.orgId,
      inquired_at: { gte: monthStart, lte: monthEnd },
      reason: { in: ['相互作用', '重複'] },
    },
    select: {
      id: true,
      cycle_id: true,
      reason: true,
      result: true,
      change_detail: true,
      cycle: {
        select: {
          patient_id: true,
        },
      },
      issue: {
        select: {
          category: true,
        },
      },
    },
  });

  const created = [];

  for (const inquiry of inquiries) {
    if (!inquiry.cycle?.patient_id) continue;

    const feeType = parseHomeDuplicateInteractionFeeType({
      reason: inquiry.reason,
      changeDetail: inquiry.change_detail,
    });
    const rule = HOME_DUPLICATE_INTERACTION_RULES[feeType];
    const dedupeKey = `${monthLabel(monthStart)}:home-dup:${inquiry.id}:${feeType}`;
    const existing = args.existingByKey.get(dedupeKey);
    const existingWorkflow = readBillingCandidateWorkflowState(existing?.source_snapshot);
    const exclusionReason =
      inquiry.result === 'changed'
        ? null
        : inquiry.result === 'unchanged'
          ? '処方変更に至っていないため在宅患者重複投薬・相互作用等防止管理料は算定できません'
          : '疑義照会の結果が未確定のため在宅患者重複投薬・相互作用等防止管理料は保留です';
    const status =
      exclusionReason != null
        ? 'excluded'
        : existingWorkflow.closed_at
          ? 'exported'
          : existingWorkflow.resolution_state === 'confirmed'
            ? 'confirmed'
            : existingWorkflow.resolution_state === 'excluded'
              ? 'excluded'
              : 'candidate';

    const candidate = await tx.billingCandidate.upsert({
      where: {
        org_id_dedupe_key: {
          org_id: args.orgId,
          dedupe_key: dedupeKey,
        },
      },
      create: {
        org_id: args.orgId,
        patient_id: inquiry.cycle.patient_id,
        cycle_id: inquiry.cycle_id,
        evidence_id: null,
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        dedupe_key: dedupeKey,
        billing_month: monthStart,
        billing_code: rule.code,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: {
          source_type: 'inquiry_record',
          source_id: inquiry.id,
          fee_type: feeType,
          inquiry_result: inquiry.result,
          issue_category: inquiry.issue?.category ?? null,
        } as Prisma.InputJsonValue,
        source_snapshot: writeBillingCandidateWorkflowState(
          mergeCandidateSourceSnapshot({
            sourceSnapshot: {
              billing_scope: 'home_care_ssot',
              selection_mode: 'manual',
              source_note: rule.sourceNote,
              source_type: 'inquiry_record',
              source_entity_id: inquiry.id,
              duplicate_interaction_fee_type: feeType,
              ruleset_version: HOME_CARE_BILLING_RULESET_VERSION,
            },
            calculationContext: null,
            candidateStatus: status,
            claimable: exclusionReason == null,
            evidenceMessage:
              exclusionReason == null
                ? '照会結果の変更確定を確認'
                : exclusionReason,
            ruleMessage:
              exclusionReason == null
                ? `${rule.targetLabel} の加算候補`
                : exclusionReason,
            workflow: existingWorkflow,
          }) as Prisma.JsonValue,
          existingWorkflow
        ),
        status,
        exclusion_reason: exclusionReason,
      },
      update: {
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: {
          source_type: 'inquiry_record',
          source_id: inquiry.id,
          fee_type: feeType,
          inquiry_result: inquiry.result,
          issue_category: inquiry.issue?.category ?? null,
        } as Prisma.InputJsonValue,
        source_snapshot: writeBillingCandidateWorkflowState(
          mergeCandidateSourceSnapshot({
            sourceSnapshot: {
              billing_scope: 'home_care_ssot',
              selection_mode: 'manual',
              source_note: rule.sourceNote,
              source_type: 'inquiry_record',
              source_entity_id: inquiry.id,
              duplicate_interaction_fee_type: feeType,
              ruleset_version: HOME_CARE_BILLING_RULESET_VERSION,
            },
            calculationContext: null,
            candidateStatus: status,
            claimable: exclusionReason == null,
            evidenceMessage:
              exclusionReason == null
                ? '照会結果の変更確定を確認'
                : exclusionReason,
            ruleMessage:
              exclusionReason == null
                ? `${rule.targetLabel} の加算候補`
                : exclusionReason,
            workflow: existingWorkflow,
          }) as Prisma.JsonValue,
          existingWorkflow
        ),
        status,
        exclusion_reason: exclusionReason,
      },
    });

    created.push(candidate);
  }

  return created;
}

export async function upsertBillingEvidenceForVisit(
  tx: Tx,
  args: { orgId: string; visitRecordId: string }
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
      medical_insurance_number: true,
      care_insurance_number: true,
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

  const billingMonth = startOfMonth(visitRecord.visit_date);
  const weekStart = startOfWeek(visitRecord.visit_date);
  const weekEnd = endOfWeek(weekStart);
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
  ] =
    await Promise.all([
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
          gte: billingMonth,
          lte: endOfMonth(visitRecord.visit_date),
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
    resolveBuildingPatientCount(tx, {
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
    }),
    resolveBillingAssignment(tx, {
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
    }),
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
  ]);

  const payerBasis = getPayerBasis({
    medicalInsuranceNumber: patient.medical_insurance_number,
    careInsuranceNumber: patient.care_insurance_number,
    visitType: visitRecord.schedule.visit_type,
  });
  const allReportsDelivered =
    reports.length > 0 &&
    reports.every((report) => ['sent', 'confirmed'].includes(report.status)) &&
    deliveryRecords.every((delivery) => ['sent', 'confirmed'].includes(delivery.status));

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
  const visitDate = visitRecord.visit_date;

  // 乳幼児判定 (6歳未満)
  let infantEligible = false;
  if (patient.birth_date) {
    const bd = new Date(patient.birth_date);
    const ageYears = visitDate.getFullYear() - bd.getFullYear();
    const hadBirthday =
      visitDate.getMonth() > bd.getMonth() ||
      (visitDate.getMonth() === bd.getMonth() && visitDate.getDate() >= bd.getDate());
    infantEligible = hadBirthday ? ageYears < 6 : ageYears - 1 < 6;
  }

  // 小児特定加算判定 (18歳未満 — 障害児判定は手動のため候補提示のみ)
  let pediatricAge = false;
  if (patient.birth_date) {
    const bd = new Date(patient.birth_date);
    const ageYears = visitDate.getFullYear() - bd.getFullYear();
    const hadBirthday =
      visitDate.getMonth() > bd.getMonth() ||
      (visitDate.getMonth() === bd.getMonth() && visitDate.getDate() >= bd.getDate());
    pediatricAge = hadBirthday ? ageYears < 18 : ageYears - 1 < 18;
  }

  // 介護認定レベル判定 (intake の care_level から)
  const caseData = patient.cases?.[0] ?? null;
  const intakeJson = (caseData?.required_visit_support as Record<string, unknown> | null)
    ?.home_visit_intake as Record<string, unknown> | null;
  const careLevel = (intakeJson?.care_level as string) ?? null;
  const careLevelCategory = careLevel
    ? careLevel.startsWith('support_') ? 'support_required' as const
      : careLevel.startsWith('care_') ? 'care_required' as const
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
  const centralVenousRequired = specialProcedures.some(p =>
    p === 'tpn' || p === 'cv_port' || p === 'central_venous'
  );
  const narcoticInjectionRequired = specialProcedures.includes('narcotics_injection');
  const enteralRequired = specialProcedures.includes('tube_feeding') ||
    (Array.isArray(intakeJson?.medication_support_methods) &&
     (intakeJson.medication_support_methods as string[]).includes('tube'));

  // ENT処方 (intake から)
  const entPrescription = intakeJson?.ent_prescription === true;

  // 特別上限対象 (末期悪性腫瘍 OR 麻薬注射 OR 中心静脈栄養)
  const specialCapEligible = narcoticInjectionRequired || centralVenousRequired || entPrescription;

  await ensureHomeCareBillingSsot(tx, args.orgId);

  const billingServiceType =
    payerBasis === 'care' ? 'care_home_management' : 'medical_home_visit';
  const providerScope = payerBasis === 'care' ? 'pharmacy' : 'pharmacy';
  const candidateSpecs = await buildBillingCandidateSpecs(tx, {
    orgId: args.orgId,
    payerBasis,
    serviceType: billingServiceType,
    providerScope,
    buildingPatientCount,
    monthlyVisitCount,
    weeklyVisitCount,
    claimable,
    exclusionReason,
    specialCapEligible,
    onlineEligible: false,
    regionAddOnEligible: [],
    visitType: visitRecord.schedule.visit_type,
    // 自動判定された患者条件
    infantEligible,
    pediatricAge,
    narcoticRequired,
    narcoticInjectionRequired,
    centralVenousRequired,
    enteralRequired,
    careLevelCategory,
  });

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
      report_delivery_ref:
        deliveryRecords.length > 0 ? deliveryRecords.map((record) => record.id).join(',') : null,
      visit_record_ref: visitRecord.id,
      building_patient_count: buildingPatientCount,
      monthly_count_snapshot: monthlyVisitCount,
      weekly_count_snapshot: weeklyVisitCount,
      applied_rule_keys: candidateSpecs
        .filter((spec) => spec.status === 'confirmed')
        .map((spec) => spec.ssotKey) as Prisma.InputJsonValue,
      recommended_rule_keys: candidateSpecs
        .filter((spec) => spec.status === 'candidate')
        .map((spec) => spec.ssotKey) as Prisma.InputJsonValue,
      calculation_context: {
        billing_service_type: billingServiceType,
        provider_scope: providerScope,
        building_patient_count: buildingPatientCount,
        unit_patient_count: billingAssignment.unit_patient_count,
        building_id: billingAssignment.building_id,
        unit_name: billingAssignment.unit_name,
        assignment_scope: billingAssignment.assignment_scope,
        monthly_visit_count: monthlyVisitCount,
        weekly_visit_count: weeklyVisitCount,
      } as Prisma.InputJsonValue,
      same_month_exclusion_flags: exclusionFlags as Prisma.InputJsonValue,
      validation_notes: claimable
        ? '同意・管理計画書・報告送付を満たしています'
        : exclusionReason,
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
      report_delivery_ref:
        deliveryRecords.length > 0 ? deliveryRecords.map((record) => record.id).join(',') : null,
      visit_record_ref: visitRecord.id,
      building_patient_count: buildingPatientCount,
      monthly_count_snapshot: monthlyVisitCount,
      weekly_count_snapshot: weeklyVisitCount,
      applied_rule_keys: candidateSpecs
        .filter((spec) => spec.status === 'confirmed')
        .map((spec) => spec.ssotKey) as Prisma.InputJsonValue,
      recommended_rule_keys: candidateSpecs
        .filter((spec) => spec.status === 'candidate')
        .map((spec) => spec.ssotKey) as Prisma.InputJsonValue,
      calculation_context: {
        billing_service_type: billingServiceType,
        provider_scope: providerScope,
        building_patient_count: buildingPatientCount,
        unit_patient_count: billingAssignment.unit_patient_count,
        building_id: billingAssignment.building_id,
        unit_name: billingAssignment.unit_name,
        assignment_scope: billingAssignment.assignment_scope,
        monthly_visit_count: monthlyVisitCount,
        weekly_visit_count: weeklyVisitCount,
      } as Prisma.InputJsonValue,
      same_month_exclusion_flags: exclusionFlags as Prisma.InputJsonValue,
      validation_notes: claimable
        ? '同意・管理計画書・報告送付を満たしています'
        : exclusionReason,
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
  args: { orgId: string; billingMonth: Date }
) {
  const billingMonth = startOfMonth(args.billingMonth);
  const [candidates, blockedEvidences] = await Promise.all([
    tx.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        billing_month: billingMonth,
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
            (blockerReasons.get(candidate.exclusion_reason) ?? 0) + 1
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
        (blockerReasons.get(evidence.exclusion_reason) ?? 0) + 1
      );
    }
  }

  summary.blocker_reasons = Array.from(blockerReasons.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, 'ja'))
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
  }
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
            args.action === 'confirm'
              ? ('confirmed' as const)
              : ('excluded' as const),
          reviewed_at: reviewedAt.toISOString(),
          reviewed_by: args.actorId,
          closed_at: null,
          closed_by: null,
          note: args.note ?? (args.action === 'exclude' ? candidate.exclusion_reason ?? null : null),
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
  }
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
        })
      )
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

export async function generateBillingCandidatesForMonth(
  tx: Tx,
  args: { orgId: string; billingMonth: Date }
) {
  await ensureHomeCareBillingSsot(tx, args.orgId);
  const monthStart = startOfMonth(args.billingMonth);
  const evidences = await tx.billingEvidence.findMany({
    where: {
      org_id: args.orgId,
      billing_month: monthStart,
    },
    orderBy: [{ created_at: 'asc' }],
  });

  const created = [];
  const rules = await tx.billingRule.findMany({
    where: {
      org_id: args.orgId,
    },
    select: {
      id: true,
      ssot_key: true,
    },
  });
  const ruleIdByKey = new Map(
    rules
      .filter((rule) => rule.ssot_key)
      .map((rule) => [rule.ssot_key as string, rule.id])
  );
  const existingCandidates = await tx.billingCandidate.findMany({
    where: {
      org_id: args.orgId,
      billing_month: monthStart,
    },
    select: {
      dedupe_key: true,
      source_snapshot: true,
    },
  });
  const existingByKey = new Map(
    existingCandidates
      .filter((candidate) => candidate.dedupe_key)
      .map((candidate) => [candidate.dedupe_key as string, candidate])
  );
  const blockedEvidenceIds: string[] = [];
  const claimableEvidenceByPatient = new Map<string, { any: number; care: number }>();

  for (const evidence of evidences) {
    if (!evidence.patient_id || !evidence.claimable) continue;
    const current = claimableEvidenceByPatient.get(evidence.patient_id) ?? { any: 0, care: 0 };
    current.any += 1;
    if (evidence.billing_service_type === 'care_home_management') {
      current.care += 1;
    }
    claimableEvidenceByPatient.set(evidence.patient_id, current);
  }

  for (const evidence of evidences) {
    if (!evidence.patient_id) continue;
    if (!evidence.claimable) {
      blockedEvidenceIds.push(evidence.id);
      continue;
    }

    const specs = await buildBillingCandidateSpecs(tx, {
      orgId: args.orgId,
      payerBasis: evidence.payer_basis,
      serviceType:
        evidence.billing_service_type === 'care_home_management'
          ? 'care_home_management'
          : 'medical_home_visit',
      providerScope:
        evidence.provider_scope === 'hospital_clinic' ? 'hospital_clinic' : 'pharmacy',
      buildingPatientCount: evidence.building_patient_count ?? 1,
      monthlyVisitCount: evidence.monthly_count_snapshot ?? 0,
      weeklyVisitCount: evidence.weekly_count_snapshot ?? 0,
      claimable: evidence.claimable,
      exclusionReason: evidence.exclusion_reason,
      specialCapEligible: false,
      onlineEligible: false,
      regionAddOnEligible: [],
    });

    for (const spec of specs) {
      const dedupeKey = `${monthStart.toISOString().slice(0, 10)}:${evidence.id}:${spec.code}`;
      const existing = existingByKey.get(dedupeKey);
      const existingWorkflow = readBillingCandidateWorkflowState(existing?.source_snapshot);
      const preservedStatus =
        existingWorkflow.closed_at
          ? 'exported'
          : existingWorkflow.resolution_state === 'confirmed'
            ? 'confirmed'
            : existingWorkflow.resolution_state === 'excluded'
              ? 'excluded'
              : spec.status;
      const preservedExclusionReason =
        preservedStatus === 'excluded' && existingWorkflow.note
          ? existingWorkflow.note
          : spec.exclusionReason;

      const candidate = await tx.billingCandidate.upsert({
        where: {
          org_id_dedupe_key: {
            org_id: args.orgId,
            dedupe_key: dedupeKey,
          },
        },
        create: {
          org_id: args.orgId,
          patient_id: evidence.patient_id,
          cycle_id: evidence.cycle_id ?? null,
          evidence_id: evidence.id,
          rule_id: ruleIdByKey.get(spec.ssotKey) ?? null,
          dedupe_key: dedupeKey,
          billing_month: monthStart,
          billing_code: spec.code,
          billing_name: spec.name,
          points: spec.points,
          quantity: 1,
          calculation_breakdown: spec.calculationBreakdown as Prisma.InputJsonValue,
          source_snapshot: writeBillingCandidateWorkflowState(
            mergeCandidateSourceSnapshot({
              sourceSnapshot: spec.sourceSnapshot,
              calculationContext: evidence.calculation_context,
              candidateStatus: preservedStatus,
              claimable: evidence.claimable,
              evidenceMessage:
                evidence.claimable
                  ? '同意・管理計画書・報告送付を満たしています'
                  : evidence.exclusion_reason ?? '請求根拠の確認が必要です',
              ruleMessage:
                spec.exclusionReason ??
                (preservedStatus === 'candidate'
                  ? '算定候補のため月次レビューで確定してください'
                  : 'SSOTルールに適合しています'),
              workflow: existingWorkflow,
            }) as Prisma.JsonValue,
            existingWorkflow
          ),
          status: preservedStatus,
          exclusion_reason: preservedExclusionReason,
        },
        update: {
          evidence_id: evidence.id,
          cycle_id: evidence.cycle_id ?? null,
          rule_id: ruleIdByKey.get(spec.ssotKey) ?? null,
          billing_name: spec.name,
          points: spec.points,
          quantity: 1,
          calculation_breakdown: spec.calculationBreakdown as Prisma.InputJsonValue,
          source_snapshot: writeBillingCandidateWorkflowState(
            mergeCandidateSourceSnapshot({
              sourceSnapshot: spec.sourceSnapshot,
              calculationContext: evidence.calculation_context,
              candidateStatus: preservedStatus,
              claimable: evidence.claimable,
              evidenceMessage:
                evidence.claimable
                  ? '同意・管理計画書・報告送付を満たしています'
                  : evidence.exclusion_reason ?? '請求根拠の確認が必要です',
              ruleMessage:
                spec.exclusionReason ??
                (preservedStatus === 'candidate'
                  ? '算定候補のため月次レビューで確定してください'
                  : 'SSOTルールに適合しています'),
              workflow: existingWorkflow,
            }) as Prisma.JsonValue,
            existingWorkflow
          ),
          status: preservedStatus,
          exclusion_reason: preservedExclusionReason,
        },
      });

      created.push(candidate);
    }
  }

  if (blockedEvidenceIds.length > 0) {
    await tx.billingCandidate.deleteMany({
      where: {
        org_id: args.orgId,
        billing_month: monthStart,
        evidence_id: { in: blockedEvidenceIds },
        status: { not: 'exported' },
      },
    });
  }

  const [informationProvisionCandidates, homeDuplicateInteractionCandidates] = await Promise.all([
    generateInformationProvisionCandidates(tx, {
      orgId: args.orgId,
      billingMonth: monthStart,
      ruleIdByKey,
      existingByKey,
      claimableEvidenceByPatient,
    }),
    generateHomeDuplicateInteractionCandidates(tx, {
      orgId: args.orgId,
      billingMonth: monthStart,
      ruleIdByKey,
      existingByKey,
    }),
  ]);

  return [...created, ...informationProvisionCandidates, ...homeDuplicateInteractionCandidates];
}
