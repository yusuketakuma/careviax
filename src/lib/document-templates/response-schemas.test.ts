import { describe, expect, it } from 'vitest';
import { documentDeliveryRulesResponseSchema } from './response-schemas';

function buildPayload() {
  return {
    data: [
      {
        id: 'rule_1',
        org_id: 'provider-only-org-id',
        document_type: 'care_report',
        target_role: 'physician',
        channel: 'fax',
        fallback_channels: ['email'],
        is_active: true,
        updated_at: '2026-07-17T00:00:00.000Z',
        created_at: '2026-07-13T00:00:00.000Z',
      },
    ],
    meta: {
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'document_delivery_rules',
      filters_applied: { document_type: null },
      limit: 100,
    },
  };
}

describe('documentDeliveryRulesResponseSchema', () => {
  it('projects only the delivery-rule fields consumed by the manager', () => {
    const parsed = documentDeliveryRulesResponseSchema.parse(buildPayload());
    expect(parsed.data[0]).not.toHaveProperty('org_id');
    expect(parsed.data[0]).not.toHaveProperty('created_at');
    expect(parsed.data[0]).toHaveProperty('updated_at', '2026-07-17T00:00:00.000Z');
  });

  it.each([
    { rules: buildPayload().data, meta: buildPayload().meta },
    { ...buildPayload(), debug: true },
    {
      ...buildPayload(),
      data: [buildPayload().data[0], buildPayload().data[0]],
      meta: { ...buildPayload().meta, visible_count: 2, total_count: 2 },
    },
    {
      ...buildPayload(),
      data: [{ ...buildPayload().data[0], fallback_channels: ['fax'] }],
    },
    { ...buildPayload(), meta: { ...buildPayload().meta, hidden_count: 1 } },
  ])('rejects malformed delivery-rule list %#', (payload) => {
    expect(documentDeliveryRulesResponseSchema.safeParse(payload).success).toBe(false);
  });
});
