import type { Prisma } from '@prisma/client';
import { HOME_CARE_BILLING_RULESET_VERSION } from '../home-care-billing-ssot';
import type {
  Tx,
  AdditionalBillingRuleDefinition,
} from './core';
import {
  startOfMonth,
  endOfMonth,
  monthLabel,
  readBillingCandidateWorkflowState,
  writeBillingCandidateWorkflowState,
  mergeCandidateSourceSnapshot,
} from './core';

export type HomeDuplicateInteractionFeeType =
  | '1_i'
  | '1_ro'
  | '2_i'
  | '2_ro';

export const HOME_DUPLICATE_INTERACTION_RULES: Record<
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

export function parseHomeDuplicateInteractionFeeType(args: {
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

export async function generateHomeDuplicateInteractionCandidates(
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
