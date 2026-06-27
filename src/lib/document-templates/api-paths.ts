import { encodePathSegment } from '@/lib/http/path-segment';

export function buildDocumentTemplateApiPath(templateId: string) {
  return `/api/templates/${encodePathSegment(templateId)}`;
}

export function buildDocumentDeliveryRuleApiPath(ruleId: string) {
  return `/api/document-delivery-rules/${encodePathSegment(ruleId)}`;
}
