import { encodePathSegment } from '@/lib/http/path-segment';

export const ESCALATION_RULES_API_PATH = '/api/admin/escalation-rules';

export function buildEscalationRulesApiPath(params?: URLSearchParams) {
  const query = params?.toString() ?? '';
  return query ? `${ESCALATION_RULES_API_PATH}?${query}` : ESCALATION_RULES_API_PATH;
}

export function buildEscalationRuleApiPath(ruleId: string) {
  return `${ESCALATION_RULES_API_PATH}/${encodePathSegment(ruleId)}`;
}
