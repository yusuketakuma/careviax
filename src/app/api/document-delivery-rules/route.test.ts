import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  documentDeliveryRuleFindManyMock,
  documentDeliveryRuleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  documentDeliveryRuleFindManyMock: vi.fn(),
  documentDeliveryRuleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/document-delivery-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    documentDeliveryRuleFindManyMock.mockResolvedValue([{ id: 'rule_1' }]);
    documentDeliveryRuleCreateMock.mockResolvedValue({ id: 'rule_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        documentDeliveryRule: {
          findMany: documentDeliveryRuleFindManyMock,
          create: documentDeliveryRuleCreateMock,
        },
      }),
    );
  });

  it('lists document delivery rules', async () => {
    const response = (await GET({
      url: 'http://localhost/api/document-delivery-rules',
    } as NextRequest))!;

    expect(response.status).toBe(200);
    expect(documentDeliveryRuleFindManyMock).toHaveBeenCalled();
  });

  it('creates a document delivery rule', async () => {
    const response = (await POST({
      json: async () => ({
        document_type: 'care_report',
        target_role: 'physician',
        channel: 'fax',
        fallback_channels: ['email'],
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(documentDeliveryRuleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        document_type: 'care_report',
        target_role: 'physician',
        channel: 'fax',
        fallback_channels: ['email'],
      }),
    });
  });
});
