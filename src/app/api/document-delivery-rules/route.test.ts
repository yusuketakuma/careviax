import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  documentDeliveryRuleFindManyMock,
  documentDeliveryRuleCountMock,
  documentDeliveryRuleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  documentDeliveryRuleFindManyMock: vi.fn(),
  documentDeliveryRuleCountMock: vi.fn(),
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

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

const documentDeliveryRulesUrl = 'http://localhost/api/document-delivery-rules';

function createRequest(body?: unknown, url = documentDeliveryRulesUrl) {
  const init: NextRequestInit = {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/document-delivery-rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  } satisfies NextRequestInit);
}

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
    documentDeliveryRuleCountMock.mockResolvedValue(1);
    documentDeliveryRuleCreateMock.mockResolvedValue({ id: 'rule_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        documentDeliveryRule: {
          findMany: documentDeliveryRuleFindManyMock,
          count: documentDeliveryRuleCountMock,
          create: documentDeliveryRuleCreateMock,
        },
      }),
    );
  });

  it('lists document delivery rules', async () => {
    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(200);
    expect(documentDeliveryRuleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
      },
      orderBy: [{ document_type: 'asc' }, { target_role: 'asc' }, { updated_at: 'desc' }],
      take: 100,
    });
    expect(documentDeliveryRuleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'rule_1' }],
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'document_delivery_rules',
      filters_applied: {
        document_type: null,
      },
      limit: 100,
    });
  });

  it('bounds list size and trims document_type query filters', async () => {
    const response = (await GET(
      createRequest(
        undefined,
        `${documentDeliveryRulesUrl}?document_type=%20care_report%20&limit=5`,
      ),
    ))!;

    expect(response.status).toBe(200);
    expect(documentDeliveryRuleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        document_type: 'care_report',
      },
      orderBy: [{ document_type: 'asc' }, { target_role: 'asc' }, { updated_at: 'desc' }],
      take: 5,
    });
    expect(documentDeliveryRuleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        document_type: 'care_report',
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      filters_applied: {
        document_type: 'care_report',
      },
      limit: 5,
    });
  });

  it('clamps overly large list limits', async () => {
    const response = (await GET(
      createRequest(undefined, `${documentDeliveryRulesUrl}?limit=9999`),
    ))!;

    expect(response.status).toBe(200);
    expect(documentDeliveryRuleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      limit: 200,
    });
  });

  it('reports hidden rule counts when the bounded list is truncated', async () => {
    documentDeliveryRuleFindManyMock.mockResolvedValue([{ id: 'rule_1' }, { id: 'rule_2' }]);
    documentDeliveryRuleCountMock.mockResolvedValue(5);

    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'rule_1' }, { id: 'rule_2' }],
      total_count: 5,
      visible_count: 2,
      hidden_count: 3,
      truncated: true,
      count_basis: 'document_delivery_rules',
    });
  });

  it('rejects blank document_type query filters before opening an org context', async () => {
    const response = (await GET(
      createRequest(undefined, `${documentDeliveryRulesUrl}?document_type=%20%20`),
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(documentDeliveryRuleFindManyMock).not.toHaveBeenCalled();
    expect(documentDeliveryRuleCountMock).not.toHaveBeenCalled();
  });

  it('creates a document delivery rule', async () => {
    const response = (await POST(
      createRequest({
        document_type: 'care_report',
        target_role: 'physician',
        channel: 'fax',
        fallback_channels: ['email'],
      }),
    ))!;

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

  it('rejects non-object create payloads before opening an org transaction', async () => {
    const response = (await POST(createRequest([])))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(documentDeliveryRuleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before opening an org transaction', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(documentDeliveryRuleCreateMock).not.toHaveBeenCalled();
  });
});
