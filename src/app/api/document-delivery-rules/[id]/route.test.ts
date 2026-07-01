import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  documentDeliveryRuleFindFirstMock,
  documentDeliveryRuleUpdateMock,
  documentDeliveryRuleDeleteMock,
  withOrgContextMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  documentDeliveryRuleFindFirstMock: vi.fn(),
  documentDeliveryRuleUpdateMock: vi.fn(),
  documentDeliveryRuleDeleteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
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

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
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

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function expectOrgContextBoundToRequestContext() {
  expect(withOrgContextMock).toHaveBeenCalled();
  for (const call of withOrgContextMock.mock.calls) {
    expect(call[2]).toEqual({
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
    });
  }
}

async function expectInternalError(response: Response, rawMessage: string) {
  expect(response.status).toBe(500);
  expectNoStore(response);
  const body = await response.json();
  expect(body).toMatchObject({
    code: 'INTERNAL_ERROR',
    message: 'サーバー内部でエラーが発生しました',
  });
  expect(JSON.stringify(body)).not.toContain(rawMessage);
}

describe('/api/document-delivery-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    documentDeliveryRuleFindFirstMock.mockResolvedValue({ id: 'rule_1' });
    documentDeliveryRuleUpdateMock.mockResolvedValue({
      id: 'rule_1',
      channel: 'fax',
      is_active: true,
    });
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
      expectNoStore(response);
      expect(documentDeliveryRuleUpdateMock).toHaveBeenCalledWith({
        where: { id: 'rule_1' },
        data: {
          channel: 'fax',
          fallback_channels: ['email'],
          is_active: true,
        },
      });
      expectOrgContextBoundToRequestContext();
    });

    it('rejects malformed JSON update payloads before loading the delivery rule', async () => {
      const response = (await PATCH(
        createInvalidJsonRequest('http://localhost/api/document-delivery-rules/rule_1'),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleFindFirstMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects non-object update payloads before loading the delivery rule', async () => {
      const response = (await PATCH(
        createRequest('http://localhost/api/document-delivery-rules/rule_1', []),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleFindFirstMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects blank route ids before loading the delivery rule', async () => {
      const response = (await PATCH(
        createRequest('http://localhost/api/document-delivery-rules/%20%20%20', {
          channel: 'fax',
        }),
        { params: Promise.resolve({ id: '   ' }) },
      ))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: '文書送達ルールIDが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleFindFirstMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleUpdateMock).not.toHaveBeenCalled();
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
      expectNoStore(response);
    });

    it('adds no-store headers to auth failures before loading the delivery rule', async () => {
      authMock.mockResolvedValue(null);

      const response = (await PATCH(
        createRequest('http://localhost/api/document-delivery-rules/rule_1', {
          channel: 'fax',
        }),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(401);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns a no-store internal error envelope when updating a rule throws', async () => {
      const rawMessage = 'database exploded while updating rules';
      const error = new Error(rawMessage);
      documentDeliveryRuleUpdateMock.mockRejectedValueOnce(error);

      const response = (await PATCH(
        createRequest('http://localhost/api/document-delivery-rules/rule_1', {
          channel: 'fax',
        }),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      await expectInternalError(response, rawMessage);
      expect(loggerErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'document_delivery_rules_id_patch_unhandled_error',
          route: '/api/document-delivery-rules/:id',
          method: 'PATCH',
          status: 500,
        }),
        error,
      );
    });
  });

  describe('DELETE', () => {
    it('returns 200 when deleting a delivery rule', async () => {
      const response = (await DELETE(
        createRequest('http://localhost/api/document-delivery-rules/rule_1'),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(200);
      expectNoStore(response);
      expectOrgContextBoundToRequestContext();
    });

    it('rejects blank route ids before loading the delivery rule', async () => {
      const response = (await DELETE(
        createRequest('http://localhost/api/document-delivery-rules/%20%20%20'),
        { params: Promise.resolve({ id: '   ' }) },
      ))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: '文書送達ルールIDが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleFindFirstMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleDeleteMock).not.toHaveBeenCalled();
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
      expectNoStore(response);
    });

    it('adds no-store headers to auth failures before loading the delivery rule', async () => {
      authMock.mockResolvedValue(null);

      const response = (await DELETE(
        createRequest('http://localhost/api/document-delivery-rules/rule_1'),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(401);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns a no-store internal error envelope when deleting a rule throws', async () => {
      const rawMessage = 'database exploded while deleting rules';
      const error = new Error(rawMessage);
      documentDeliveryRuleDeleteMock.mockRejectedValueOnce(error);

      const response = (await DELETE(
        createRequest('http://localhost/api/document-delivery-rules/rule_1'),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      await expectInternalError(response, rawMessage);
      expect(loggerErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'document_delivery_rules_id_delete_unhandled_error',
          route: '/api/document-delivery-rules/:id',
          method: 'DELETE',
          status: 500,
        }),
        error,
      );
    });
  });
});
