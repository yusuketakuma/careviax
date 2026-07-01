import { encodePathSegment } from '@/lib/http/path-segment';

export const DOCUMENT_TEMPLATES_API_PATH = '/api/templates';
export const DOCUMENT_DELIVERY_RULES_API_PATH = '/api/document-delivery-rules';

export function buildDocumentTemplatesApiPath(params?: URLSearchParams) {
  const query = params?.toString() ?? '';
  return query ? `${DOCUMENT_TEMPLATES_API_PATH}?${query}` : DOCUMENT_TEMPLATES_API_PATH;
}

export function buildDocumentTemplateApiPath(templateId: string) {
  return `${DOCUMENT_TEMPLATES_API_PATH}/${encodePathSegment(templateId)}`;
}

export function buildDocumentDeliveryRuleApiPath(ruleId: string) {
  return `${DOCUMENT_DELIVERY_RULES_API_PATH}/${encodePathSegment(ruleId)}`;
}
