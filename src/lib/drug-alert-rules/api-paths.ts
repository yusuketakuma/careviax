import { encodePathSegment } from '@/lib/http/path-segment';

export const DRUG_ALERT_RULES_API_PATH = '/api/drug-alert-rules';

export function buildDrugAlertRuleApiPath(ruleId: string) {
  return `${DRUG_ALERT_RULES_API_PATH}/${encodePathSegment(ruleId)}`;
}
