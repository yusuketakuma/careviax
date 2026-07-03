import { resolveBillingRulesForDate } from '../billing-rules';

/**
 * Resolve the active medical billing registry into an ssot_key -> amount map.
 * Revision cutover stays delegated to billing-rules/revisions.
 */
export function resolveBillingAmountByKey(billingMonth: Date): Map<string, number> {
  return new Map(
    resolveBillingRulesForDate({ payerBasis: 'medical', asOfDate: billingMonth }).map(
      (rule) => [rule.ssot_key, rule.amount] as const,
    ),
  );
}
