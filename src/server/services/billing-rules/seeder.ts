import { Prisma } from '@prisma/client';
import type { BillingRevision, BillingRuleSeed } from './types';
import { MEDICAL_REVISION, MEDICAL_RULES_2024 } from './medical-2024';
import { CARE_REVISION, CARE_RULES_2024 } from './care-2024';

type Tx = Prisma.TransactionClient;

export const HOME_CARE_BILLING_RULESET_VERSION = '2026-revision-v1';

const MEDICAL_SOURCE_URL =
  'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000188411_00045.html';
const CARE_SOURCE_URL = 'https://www.mhlw.go.jp/stf/newpage_38790.html';

export async function ensureHomeCareBillingSsot(
  tx: Tx,
  orgId: string,
  revisions?: Array<{ revision: BillingRevision; rules: BillingRuleSeed[] }>
) {
  await tx.sourceOfTruthMatrix.upsert({
    where: {
      org_id_entity_type: {
        org_id: orgId,
        entity_type: 'billing',
      },
    },
    create: {
      org_id: orgId,
      entity_type: 'billing',
      source_of_truth: 'careviax',
      sync_direction: 'push',
      recovery_procedure: 'BillingRule home_care_ssot を唯一の算定SSOTとして運用',
    },
    update: {
      source_of_truth: 'careviax',
      sync_direction: 'push',
      recovery_procedure: 'BillingRule home_care_ssot を唯一の算定SSOTとして運用',
    },
  });

  const allRevisions = revisions ?? [
    { revision: MEDICAL_REVISION, rules: MEDICAL_RULES_2024 },
    { revision: CARE_REVISION, rules: CARE_RULES_2024 },
  ];

  let seeded = 0;

  for (const { revision, rules } of allRevisions) {
    for (const rule of rules) {
      const ruleData = {
        billing_scope: 'home_care_ssot',
        rule_type: rule.rule_type,
        service_type: rule.service_type,
        payer_basis: rule.payer_basis,
        provider_scope: rule.provider_scope,
        selection_mode: rule.selection_mode,
        calculation_unit: rule.calculation_unit,
        display_order: rule.display_order,
        name: rule.name,
        code: rule.code,
        conditions: rule.conditions as Prisma.InputJsonValue,
        evidence_requirements: (rule.evidence_requirements ?? {}) as Prisma.InputJsonValue,
        source_url: rule.source_url,
        source_note: rule.source_note,
        amount: rule.amount,
        effective_from: revision.effectiveFrom,
        effective_to: revision.effectiveTo,
      };

      await tx.billingRule.upsert({
        where: {
          org_id_ssot_key: {
            org_id: orgId,
            ssot_key: rule.ssot_key,
          },
        },
        create: {
          org_id: orgId,
          ssot_key: rule.ssot_key,
          ...ruleData,
          is_system: true,
          is_active: true,
        },
        update: {
          ...ruleData,
          is_system: true,
        },
      });

      seeded++;
    }
  }

  return {
    seeded,
    medicalSourceUrl: MEDICAL_SOURCE_URL,
    careSourceUrl: CARE_SOURCE_URL,
  };
}
