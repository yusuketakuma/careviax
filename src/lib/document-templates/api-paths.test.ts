import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_DELIVERY_RULES_API_PATH,
  DOCUMENT_TEMPLATES_API_PATH,
  buildDocumentDeliveryRulesApiPath,
  buildDocumentDeliveryRuleApiPath,
  buildDocumentTemplateApiPath,
  buildDocumentTemplatesApiPath,
} from './api-paths';

describe('document template API path helpers', () => {
  it('builds collection paths without adding an empty search suffix', () => {
    expect(DOCUMENT_TEMPLATES_API_PATH).toBe('/api/templates');
    expect(DOCUMENT_DELIVERY_RULES_API_PATH).toBe('/api/document-delivery-rules');
    expect(buildDocumentTemplatesApiPath()).toBe('/api/templates');
    expect(buildDocumentTemplatesApiPath(new URLSearchParams())).toBe('/api/templates');
    expect(buildDocumentDeliveryRulesApiPath()).toBe('/api/document-delivery-rules');
    expect(buildDocumentDeliveryRulesApiPath(new URLSearchParams())).toBe(
      '/api/document-delivery-rules',
    );
  });

  it('builds encoded collection query paths', () => {
    const templateParams = new URLSearchParams({
      template_type: 'care_report',
      cursor: 'template/1?x=y#frag',
    });
    const ruleParams = new URLSearchParams({
      document_type: 'care_report',
      cursor: 'rule/1?x=y#frag',
    });

    expect(buildDocumentTemplatesApiPath(templateParams)).toBe(
      '/api/templates?template_type=care_report&cursor=template%2F1%3Fx%3Dy%23frag',
    );
    expect(buildDocumentDeliveryRulesApiPath(ruleParams)).toBe(
      '/api/document-delivery-rules?document_type=care_report&cursor=rule%2F1%3Fx%3Dy%23frag',
    );
  });

  it('builds normal template and delivery-rule paths', () => {
    expect(buildDocumentTemplateApiPath('template_1')).toBe('/api/templates/template_1');
    expect(buildDocumentDeliveryRuleApiPath('rule_1')).toBe('/api/document-delivery-rules/rule_1');
  });

  it('encodes only the id path segment', () => {
    const id = 'id/1?x=y#frag';

    expect(buildDocumentTemplateApiPath(id)).toBe(`/api/templates/${encodeURIComponent(id)}`);
    expect(buildDocumentDeliveryRuleApiPath(id)).toBe(
      `/api/document-delivery-rules/${encodeURIComponent(id)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment ids %s', (id) => {
    expect(() => buildDocumentTemplateApiPath(id)).toThrow(RangeError);
    expect(() => buildDocumentDeliveryRuleApiPath(id)).toThrow(RangeError);
  });
});
