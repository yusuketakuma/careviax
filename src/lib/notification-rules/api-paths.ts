import { encodePathSegment } from '@/lib/http/path-segment';

export const NOTIFICATION_RULES_API_PATH = '/api/notification-rules';

export function buildNotificationRulesApiPath(params?: URLSearchParams) {
  const query = params?.toString() ?? '';
  return query ? `${NOTIFICATION_RULES_API_PATH}?${query}` : NOTIFICATION_RULES_API_PATH;
}

export function buildNotificationRuleApiPath(ruleId: string) {
  return `${NOTIFICATION_RULES_API_PATH}/${encodePathSegment(ruleId)}`;
}
