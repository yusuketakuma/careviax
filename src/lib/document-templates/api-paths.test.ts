import { describe, expect, it } from 'vitest';
import { buildDocumentDeliveryRuleApiPath, buildDocumentTemplateApiPath } from './api-paths';

describe('document template API path helpers', () => {
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
