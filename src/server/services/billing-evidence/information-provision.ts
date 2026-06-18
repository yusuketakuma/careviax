import type { Prisma } from '@prisma/client';
import { normalizeJsonInput } from '@/lib/db/json';
import { HOME_CARE_BILLING_RULESET_VERSION } from '../home-care-billing-ssot';
import type { AdditionalBillingRuleDefinition } from './core';
import {
  startOfMonth,
  japanMonthRangeForBillingMonth,
  monthLabel,
  asRecord,
  readBillingCandidateWorkflowState,
  writeBillingCandidateWorkflowState,
  mergeCandidateSourceSnapshot,
} from './core';
import {
  persistRegeneratedBillingCandidate,
  resolveRegeneratedCandidateStatus,
  type RegeneratedBillingCandidateRecord,
  type RegeneratedBillingCandidateTx,
} from './candidate-regeneration';

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

function normalizedJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

export type InformationProvisionFeeType = '1' | '2_i' | '2_ro' | '2_ha' | '3';

export const INFORMATION_PROVISION_RULES: Record<
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

export function parseInformationProvisionFeeType(
  content: Prisma.JsonValue | null | undefined,
  fallbackType?: InformationProvisionFeeType,
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

export type InformationProvisionCandidatesTx = RegeneratedBillingCandidateTx & {
  billingCandidate: {
    upsert(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    findFirst?(
      args: unknown,
    ): Promise<{ status: string; source_snapshot?: Prisma.JsonValue | null } | null>;
  };
  careReport: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        case_id: string | null;
        content: Prisma.JsonValue | null;
        status: string;
      }>
    >;
  };
  tracingReport: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        case_id: string | null;
        content: Prisma.JsonValue | null;
        status: string;
        sent_at: Date | null;
      }>
    >;
  };
};

type GeneratedBillingCandidate = { status: string };

export async function generateInformationProvisionCandidates(
  tx: InformationProvisionCandidatesTx,
  args: {
    orgId: string;
    billingMonth: Date;
    ruleIdByKey: Map<string, string>;
    existingByKey: Map<string, RegeneratedBillingCandidateRecord>;
    claimableEvidenceByPatient: Map<string, { any: number; care: number }>;
  },
) {
  const monthStart = startOfMonth(args.billingMonth);
  const monthRange = japanMonthRangeForBillingMonth(monthStart);

  const [tracingReports, careManagerReports] = await Promise.all([
    tx.tracingReport.findMany({
      where: {
        org_id: args.orgId,
        status: { in: ['sent', 'received', 'acknowledged'] },
        sent_at: { gte: monthRange.start, lt: monthRange.nextStart },
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
        OR: [
          {
            delivery_records: {
              some: {
                status: { in: ['sent', 'confirmed'] },
                sent_at: { gte: monthRange.start, lt: monthRange.nextStart },
              },
            },
          },
          {
            delivery_records: {
              none: {},
            },
            updated_at: { gte: monthRange.start, lt: monthRange.nextStart },
          },
        ],
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        content: true,
        status: true,
      },
    }),
  ]);

  const created: GeneratedBillingCandidate[] = [];
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
    const exclusionReason = sameMonthHomeCareClaim
      ? '同月に在宅患者訪問薬剤管理指導料等を算定しているため服薬情報等提供料は算定できません'
      : feeType === '2_ha' && sameMonthCareManagementClaim
        ? '同月に居宅療養管理指導費を算定しているため服薬情報等提供料2 ハは算定できません'
        : alreadyClaimedThisMonth
          ? '同一月内に同種の服薬情報等提供料候補が既に存在します'
          : null;
    const generatedStatus = exclusionReason != null ? 'excluded' : 'candidate';
    const status = resolveRegeneratedCandidateStatus(existing, generatedStatus);
    const preservedExclusionReason =
      status === 'excluded' ? (existingWorkflow.note ?? exclusionReason) : null;
    const calculationBreakdown = normalizedJsonObject({
      source_type: 'tracing_report',
      source_id: report.id,
      fee_type: feeType,
      target: rule.targetLabel,
      same_month_home_care_claim: sameMonthHomeCareClaim,
      same_month_care_management_claim: sameMonthCareManagementClaim,
    });
    const sourceSnapshot = writeBillingCandidateWorkflowState(
      normalizedJsonObject(
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
            exclusionReason == null ? '同月の在宅請求との併算定制約なし' : exclusionReason,
          ruleMessage:
            exclusionReason == null ? `${rule.targetLabel} の情報提供候補` : exclusionReason,
          workflow: existingWorkflow,
        }),
      ),
      existingWorkflow,
    );

    const candidate = await persistRegeneratedBillingCandidate(tx, {
      orgId: args.orgId,
      dedupeKey,
      existing,
      create: {
        org_id: args.orgId,
        patient_id: report.patient_id,
        billing_domain: 'home_care',
        billing_target_type: 'patient',
        billing_target_id: report.patient_id,
        billing_target_name: null,
        cycle_id: null,
        evidence_id: null,
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        dedupe_key: dedupeKey,
        billing_month: monthStart,
        billing_code: rule.code,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: calculationBreakdown,
        source_snapshot: sourceSnapshot,
        status,
        exclusion_reason: preservedExclusionReason,
      },
      updateScope: {
        billing_month: monthStart,
        billing_domain: 'home_care',
      },
      update: {
        billing_domain: 'home_care',
        billing_target_type: 'patient',
        billing_target_id: report.patient_id,
        billing_target_name: null,
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: calculationBreakdown,
        source_snapshot: sourceSnapshot,
        status,
        exclusion_reason: preservedExclusionReason,
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
    const exclusionReason = sameMonthHomeCareClaim
      ? '同月に在宅患者訪問薬剤管理指導料等を算定しているため服薬情報等提供料は算定できません'
      : feeType === '2_ha' && sameMonthCareManagementClaim
        ? '同月に居宅療養管理指導費を算定しているため服薬情報等提供料2 ハは算定できません'
        : alreadyClaimedThisMonth
          ? '同一月内に同種の服薬情報等提供料候補が既に存在します'
          : null;
    const generatedStatus = exclusionReason != null ? 'excluded' : 'candidate';
    const status = resolveRegeneratedCandidateStatus(existing, generatedStatus);
    const preservedExclusionReason =
      status === 'excluded' ? (existingWorkflow.note ?? exclusionReason) : null;
    const calculationBreakdown = normalizedJsonObject({
      source_type: 'care_report',
      source_id: report.id,
      fee_type: feeType,
      target: rule.targetLabel,
      same_month_home_care_claim: sameMonthHomeCareClaim,
      same_month_care_management_claim: sameMonthCareManagementClaim,
    });
    const sourceSnapshot = writeBillingCandidateWorkflowState(
      normalizedJsonObject(
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
            exclusionReason == null ? '同月の在宅請求との併算定制約なし' : exclusionReason,
          ruleMessage:
            exclusionReason == null ? `${rule.targetLabel} の情報提供候補` : exclusionReason,
          workflow: existingWorkflow,
        }),
      ),
      existingWorkflow,
    );

    const candidate = await persistRegeneratedBillingCandidate(tx, {
      orgId: args.orgId,
      dedupeKey,
      existing,
      create: {
        org_id: args.orgId,
        patient_id: report.patient_id,
        billing_domain: 'home_care',
        billing_target_type: 'patient',
        billing_target_id: report.patient_id,
        billing_target_name: null,
        cycle_id: null,
        evidence_id: null,
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        dedupe_key: dedupeKey,
        billing_month: monthStart,
        billing_code: rule.code,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: calculationBreakdown,
        source_snapshot: sourceSnapshot,
        status,
        exclusion_reason: preservedExclusionReason,
      },
      updateScope: {
        billing_month: monthStart,
        billing_domain: 'home_care',
      },
      update: {
        billing_domain: 'home_care',
        billing_target_type: 'patient',
        billing_target_id: report.patient_id,
        billing_target_name: null,
        rule_id: args.ruleIdByKey.get(rule.ssotKey) ?? null,
        billing_name: rule.name,
        points: rule.points,
        quantity: 1,
        calculation_breakdown: calculationBreakdown,
        source_snapshot: sourceSnapshot,
        status,
        exclusion_reason: preservedExclusionReason,
      },
    });

    created.push(candidate);
    if (status !== 'excluded') {
      claimedInfoTypes.add(typeScopeKey);
    }
  }

  return created;
}
