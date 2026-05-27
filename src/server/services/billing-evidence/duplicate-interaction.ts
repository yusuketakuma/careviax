import type { Prisma } from '@prisma/client';
import { HOME_CARE_BILLING_RULESET_VERSION } from '../home-care-billing-ssot';
import type { Tx, AdditionalBillingRuleDefinition } from './core';
import {
  startOfMonth,
  japanMonthRangeForBillingMonth,
  monthLabel,
  readBillingCandidateWorkflowState,
  writeBillingCandidateWorkflowState,
  mergeCandidateSourceSnapshot,
} from './core';

export type HomeDuplicateInteractionFeeType = '1_i' | '1_ro' | '2_i' | '2_ro';

// ── 2024改定: 在宅患者重複投薬・相互作用等防止管理料 (区分15の6) ──
export const HOME_DUPLICATE_INTERACTION_RULES_2024: Record<
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

// ── 2026改定: 旧「在宅患者重複投薬・相互作用等防止管理料」廃止 ──
// 「薬学的有害事象等防止加算」「調剤時残薬調整加算」に統合
// マッピング:
//   1_i (照会後変更・残薬以外) → 薬学的有害事象等防止加算 ロ(疑義照会)
//   1_ro (照会後変更・残薬)     → 調剤時残薬調整加算 ロ(在宅)
//   2_i (事前提案反映・残薬以外) → 薬学的有害事象等防止加算 イ(処方提案反映)
//   2_ro (事前提案反映・残薬)    → 調剤時残薬調整加算 ロ(在宅)
export const HOME_ADVERSE_EVENT_RULES_2026: Record<
  HomeDuplicateInteractionFeeType,
  AdditionalBillingRuleDefinition
> = {
  '1_i': {
    ssotKey: 'medical.adverse_event_prevention.home_change',
    code: 'MED_ADVERSE_EVENT_HOME_CHANGE',
    name: '薬学的有害事象等防止加算 ロ（在宅・疑義照会）',
    points: 50,
    sourceNote: '令和8年度診療報酬改定 薬学的有害事象等防止加算 ロ（在宅・疑義照会）50点',
    targetLabel: '疑義照会後変更',
  },
  '1_ro': {
    ssotKey: 'medical.residual_adjustment.home',
    code: 'MED_RESIDUAL_ADJUSTMENT_HOME',
    name: '調剤時残薬調整加算 ロ（在宅患者）',
    points: 50,
    sourceNote: '令和8年度診療報酬改定 調剤時残薬調整加算 ロ（在宅）50点',
    targetLabel: '残薬照会後変更',
  },
  '2_i': {
    ssotKey: 'medical.adverse_event_prevention.home_proposal',
    code: 'MED_ADVERSE_EVENT_HOME_PROPOSAL',
    name: '薬学的有害事象等防止加算 イ（在宅・処方提案反映）',
    points: 50,
    sourceNote: '令和8年度診療報酬改定 薬学的有害事象等防止加算 イ（在宅・処方提案反映）50点',
    targetLabel: '事前提案反映',
  },
  '2_ro': {
    ssotKey: 'medical.residual_adjustment.home',
    code: 'MED_RESIDUAL_ADJUSTMENT_HOME',
    name: '調剤時残薬調整加算 ロ（在宅患者）',
    points: 50,
    sourceNote: '令和8年度診療報酬改定 調剤時残薬調整加算 ロ（在宅）50点',
    targetLabel: '残薬事前提案反映',
  },
};

/** @deprecated 後方互換のエイリアス — 新コードでは resolveHomeDuplicateRules() を使用 */
export const HOME_DUPLICATE_INTERACTION_RULES = HOME_DUPLICATE_INTERACTION_RULES_2024;

const MEDICAL_2026_EFFECTIVE = new Date('2026-06-01');

export function resolveHomeDuplicateRules(
  billingMonth: Date,
): Record<HomeDuplicateInteractionFeeType, AdditionalBillingRuleDefinition> {
  return billingMonth >= MEDICAL_2026_EFFECTIVE
    ? HOME_ADVERSE_EVENT_RULES_2026
    : HOME_DUPLICATE_INTERACTION_RULES_2024;
}

export function parseHomeDuplicateInteractionFeeType(args: {
  reason: string;
  changeDetail?: string | null;
  proposalOrigin?: 'post_inquiry' | 'pre_issuance' | null;
  residualAdjustment?: boolean | null;
}): HomeDuplicateInteractionFeeType {
  if (args.proposalOrigin != null || args.residualAdjustment != null) {
    const isProposal = args.proposalOrigin === 'pre_issuance';
    const isResidual = args.residualAdjustment === true;
    if (isProposal) {
      return isResidual ? '2_ro' : '2_i';
    }
    return isResidual ? '1_ro' : '1_i';
  }

  const normalizedReason = args.reason.trim();
  const normalizedDetail = (args.changeDetail ?? '').trim().toLowerCase();
  const isResidual = normalizedReason.includes('残薬') || normalizedDetail.includes('residual');
  const isProposal =
    normalizedDetail.includes('proposal') ||
    normalizedDetail.includes('事前提案') ||
    normalizedDetail.includes('pre-issuance');

  if (isProposal) {
    return isResidual ? '2_ro' : '2_i';
  }
  return isResidual ? '1_ro' : '1_i';
}

export async function generateHomeDuplicateInteractionCandidates(
  tx: Tx,
  args: {
    orgId: string;
    billingMonth: Date;
    ruleIdByKey: Map<string, string>;
    existingByKey: Map<string, { source_snapshot: Prisma.JsonValue | null }>;
  },
) {
  const monthStart = startOfMonth(args.billingMonth);
  const monthRange = japanMonthRangeForBillingMonth(monthStart);
  const inquiries = await tx.inquiryRecord.findMany({
    where: {
      org_id: args.orgId,
      inquired_at: { gte: monthRange.start, lt: monthRange.nextStart },
      OR: [{ reason: { in: ['相互作用', '重複'] } }, { residual_adjustment: true }],
    },
    select: {
      id: true,
      cycle_id: true,
      reason: true,
      result: true,
      proposal_origin: true,
      residual_adjustment: true,
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
      proposalOrigin: inquiry.proposal_origin as 'post_inquiry' | 'pre_issuance' | null,
      residualAdjustment: inquiry.residual_adjustment,
    });
    const rules = resolveHomeDuplicateRules(args.billingMonth);
    const rule = rules[feeType];
    const dedupeKey = `${monthLabel(monthStart)}:home-dup:${inquiry.id}:${feeType}`;
    const existing = args.existingByKey.get(dedupeKey);
    const existingWorkflow = readBillingCandidateWorkflowState(existing?.source_snapshot);
    const exclusionReason =
      inquiry.result === 'changed'
        ? null
        : inquiry.result === 'unchanged'
          ? `処方変更に至っていないため${rule.name}は算定できません`
          : `疑義照会の結果が未確定のため${rule.name}は保留です`;
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
            evidenceMessage: exclusionReason == null ? '照会結果の変更確定を確認' : exclusionReason,
            ruleMessage:
              exclusionReason == null ? `${rule.targetLabel} の加算候補` : exclusionReason,
            workflow: existingWorkflow,
          }) as Prisma.JsonValue,
          existingWorkflow,
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
            evidenceMessage: exclusionReason == null ? '照会結果の変更確定を確認' : exclusionReason,
            ruleMessage:
              exclusionReason == null ? `${rule.targetLabel} の加算候補` : exclusionReason,
            workflow: existingWorkflow,
          }) as Prisma.JsonValue,
          existingWorkflow,
        ),
        status,
        exclusion_reason: exclusionReason,
      },
    });

    created.push(candidate);
  }

  return created;
}
