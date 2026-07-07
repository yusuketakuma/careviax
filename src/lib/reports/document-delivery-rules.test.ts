import { describe, expect, it, vi } from 'vitest';

import { resolveDocumentDeliveryRule } from './document-delivery-rules';

describe('resolveDocumentDeliveryRule', () => {
  it('uses stable top-1 ordering and filters fallback channels', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      document_type: 'care_report',
      target_role: 'physician',
      channel: 'fax',
      fallback_channels: ['phone', 123, 'postal'],
    });
    const db = {
      documentDeliveryRule: { findFirst },
    };

    const result = await resolveDocumentDeliveryRule({
      orgId: 'org_1',
      documentType: 'care_report',
      targetRole: 'physician',
      db,
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        document_type: 'care_report',
        target_role: 'physician',
        is_active: true,
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      select: {
        document_type: true,
        target_role: true,
        channel: true,
        fallback_channels: true,
      },
    });
    expect(result).toEqual({
      document_type: 'care_report',
      target_role: 'physician',
      channel: 'fax',
      fallback_channels: ['phone', 'postal'],
    });
  });
});
