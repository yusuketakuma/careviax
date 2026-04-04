import { Prisma } from '@prisma/client';
import type { BillingRevision, BillingRuleSeed } from './types';
import {
  CARE_REVISIONS,
  MEDICAL_REVISIONS,
  resolveRevisionEntryForDate,
} from './revisions';

type Tx = Prisma.TransactionClient;

export const HOME_CARE_BILLING_RULESET_VERSION = 'home-care-ssot-registry-v2';

const MEDICAL_SOURCE_URL =
  'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000188411_00045.html';
const CARE_SOURCE_URL = 'https://www.mhlw.go.jp/stf/newpage_38790.html';

export async function ensureHomeCareBillingSsot(
  tx: Tx,
  orgId: string,
  revisionsOrOptions?:
    | Array<{ revision: BillingRevision; rules: BillingRuleSeed[] }>
    | {
        asOfDate?: Date;
        revisions?: Array<{ revision: BillingRevision; rules: BillingRuleSeed[] }>;
      }
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

  const options = Array.isArray(revisionsOrOptions)
    ? { revisions: revisionsOrOptions }
    : (revisionsOrOptions ?? {});
  const asOfDate = options.asOfDate ?? new Date();
  const useRuntimeSelection = !options.revisions;
  const allRevisions =
    options.revisions ??
    [
      resolveRevisionEntryForDate(MEDICAL_REVISIONS, asOfDate),
      resolveRevisionEntryForDate(CARE_REVISIONS, asOfDate),
    ].filter((entry): entry is { revision: BillingRevision; rules: BillingRuleSeed[] } => entry != null);

  let seeded = 0;
  const activeSsotKeys = new Set<string>();

  for (const { revision, rules } of allRevisions) {
    for (const rule of rules) {
      activeSsotKeys.add(rule.ssot_key);
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
        effective_to: useRuntimeSelection ? null : revision.effectiveTo,
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

  await tx.billingRule.deleteMany({
    where: {
      org_id: orgId,
      billing_scope: 'home_care_ssot',
      is_system: true,
      ...(activeSsotKeys.size > 0
        ? { NOT: { ssot_key: { in: Array.from(activeSsotKeys) } } }
        : {}),
    },
  });

  return {
    seeded,
    medicalSourceUrl: MEDICAL_SOURCE_URL,
    careSourceUrl: CARE_SOURCE_URL,
  };
}
