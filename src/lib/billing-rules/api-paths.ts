import { encodePathSegment } from '@/lib/http/path-segment';

export const BILLING_RULES_API_PATH = '/api/billing-rules';

export function buildBillingRuleApiPath(ruleId: string) {
  return `${BILLING_RULES_API_PATH}/${encodePathSegment(ruleId)}`;
}
