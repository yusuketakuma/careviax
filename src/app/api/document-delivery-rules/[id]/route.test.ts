import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  documentDeliveryRuleFindFirstMock,
  documentDeliveryRuleUpdateMock,
  documentDeliveryRuleDeleteMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  documentDeliveryRuleFindFirstMock: vi.fn(),
  documentDeliveryRuleUpdateMock: vi.fn(),
  documentDeliveryRuleDeleteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH, DELETE } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(url: string, body?: unknown) {
  const init: NextRequestInit = {
    method: body === undefined ? 'DELETE' : 'PATCH',
    headers: {
      'x-org-id': 'org_1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

function createInvalidJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'x-org-id': 'org_1', 'content-type': 'application/json' },
    body: 'not-json',
  } satisfies NextRequestInit);
}

describe('/api/document-delivery-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    documentDeliveryRuleFindFirstMock.mockResolvedValue({ id: 'rule_1' });
    documentDeliveryRuleUpdateMock.mockResolvedValue({ id: 'rule_1', channel: 'fax', is_active: true });
    documentDeliveryRuleDeleteMock.mockResolvedValue({ id: 'rule_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        documentDeliveryRule: {
          findFirst: documentDeliveryRuleFindFirstMock,
          update: documentDeliveryRuleUpdateMock,
          delete: documentDeliveryRuleDeleteMock,
        },
      }),
    );
  });

  describe('PATCH', () => {
    it('returns 200 when updating a delivery rule', async () => {
      const response = (await PATCH(
        createRequest('http://localhost/api/document-delivery-rules/rule_1', {
          channel: 'fax',
          fallback_channels: ['email'],
          is_active: true,
        }),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(200);
      expect(documentDeliveryRuleUpdateMock).toHaveBeenCalledWith({
        where: { id: 'rule_1' },
        data: {
          channel: 'fax',
          fallback_channels: ['email'],
          is_active: true,
        },
      });
    });

    it('returns 400 with invalid body', async () => {
      const response = (await PATCH(
        createInvalidJsonRequest('http://localhost/api/document-delivery-rules/rule_1'),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(400);
    });

    it('returns 404 when rule not found', async () => {
      withOrgContextMock.mockImplementation(async (_orgId, callback) =>
        callback({
          documentDeliveryRule: {
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn(),
          },
        }),
      );

      const response = (await PATCH(
        createRequest('http://localhost/api/document-delivery-rules/nonexistent', {
          channel: 'email',
        }),
        { params: Promise.resolve({ id: 'nonexistent' }) },
      ))!;

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE', () => {
    it('returns 200 when deleting a delivery rule', async () => {
      const response = (await DELETE(
        createRequest('http://localhost/api/document-delivery-rules/rule_1'),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(200);
    });

    it('returns 404 when rule not found', async () => {
      withOrgContextMock.mockImplementation(async (_orgId, callback) =>
        callback({
          documentDeliveryRule: {
            findFirst: vi.fn().mockResolvedValue(null),
            delete: vi.fn(),
          },
        }),
      );

      const response = (await DELETE(
        createRequest('http://localhost/api/document-delivery-rules/nonexistent'),
        { params: Promise.resolve({ id: 'nonexistent' }) },
      ))!;

      expect(response.status).toBe(404);
    });
  });
});
