import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  documentDeliveryRuleFindFirstMock,
  documentDeliveryRuleUpdateManyMock,
  documentDeliveryRuleDeleteManyMock,
  withOrgContextMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  documentDeliveryRuleFindFirstMock: vi.fn(),
  documentDeliveryRuleUpdateManyMock: vi.fn(),
  documentDeliveryRuleDeleteManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({
  prisma: { membership: { findFirst: membershipFindFirstMock } },
}));

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { DELETE, PATCH } from './route';

const CURRENT_UPDATED_AT = '2026-07-17T00:00:00.000Z';
const STALE_UPDATED_AT = '2026-07-16T00:00:00.000Z';
type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/document-delivery-rules/rule_1', {
    method: 'PATCH',
    headers: { 'x-org-id': 'org_1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createDeleteRequest(
  query = `?expected_updated_at=${encodeURIComponent(CURRENT_UPDATED_AT)}`,
) {
  return new NextRequest(`http://localhost/api/document-delivery-rules/rule_1${query}`, {
    method: 'DELETE',
    headers: { 'x-org-id': 'org_1' },
  });
}

function routeContext(id = 'rule_1') {
  return { params: Promise.resolve({ id }) };
}

function expectOrgContextBoundToRequestContext() {
  expect(withOrgContextMock).toHaveBeenCalledTimes(1);
  expect(withOrgContextMock.mock.calls[0]?.[2]).toEqual({
    requestContext: expect.objectContaining({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'admin',
    }),
  });
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
    documentDeliveryRuleFindFirstMock.mockResolvedValue({
      id: 'rule_1',
      channel: 'fax',
      is_active: true,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    documentDeliveryRuleUpdateManyMock.mockResolvedValue({ count: 1 });
    documentDeliveryRuleDeleteManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        documentDeliveryRule: {
          findFirst: documentDeliveryRuleFindFirstMock,
          updateMany: documentDeliveryRuleUpdateManyMock,
          deleteMany: documentDeliveryRuleDeleteManyMock,
        },
      }),
    );
  });

  describe('PATCH', () => {
    it('updates with an organization-scoped version claim in one transaction', async () => {
      const response = (await PATCH(
        createPatchRequest({
          expected_updated_at: CURRENT_UPDATED_AT,
          channel: 'fax',
          fallback_channels: ['email'],
          is_active: true,
        }),
        routeContext(),
      ))!;

      expect(response.status).toBe(200);
      expectNoStore(response);
      expect(documentDeliveryRuleUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'rule_1',
          org_id: 'org_1',
          updated_at: new Date(CURRENT_UPDATED_AT),
        },
        data: { channel: 'fax', fallback_channels: ['email'], is_active: true },
      });
      expectOrgContextBoundToRequestContext();
      await expect(response.json()).resolves.toMatchObject({
        data: { id: 'rule_1', channel: 'fax', is_active: true },
      });
    });

    it.each([
      { name: 'missing version', body: { channel: 'fax' } },
      { name: 'invalid version', body: { expected_updated_at: 'yesterday', channel: 'fax' } },
      { name: 'non-object body', body: [] },
    ])('rejects $name before opening a transaction', async ({ body }) => {
      const response = (await PATCH(createPatchRequest(body), routeContext()))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleUpdateManyMock).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON before opening a transaction', async () => {
      const request = new NextRequest('http://localhost/api/document-delivery-rules/rule_1', {
        method: 'PATCH',
        headers: { 'x-org-id': 'org_1', 'content-type': 'application/json' },
        body: 'not-json',
      });
      const response = (await PATCH(request, routeContext()))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns 404 without claiming a missing rule', async () => {
      documentDeliveryRuleFindFirstMock.mockResolvedValueOnce(null);
      const response = (await PATCH(
        createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, channel: 'email' }),
        routeContext(),
      ))!;

      expect(response.status).toBe(404);
      expectNoStore(response);
      expect(documentDeliveryRuleUpdateManyMock).not.toHaveBeenCalled();
    });

    it('returns a typed conflict when the submitted version is stale', async () => {
      const response = (await PATCH(
        createPatchRequest({ expected_updated_at: STALE_UPDATED_AT, channel: 'email' }),
        routeContext(),
      ))!;

      expect(response.status).toBe(409);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        details: {
          conflict_type: 'stale_document_delivery_rule',
          expected_updated_at: STALE_UPDATED_AT,
          current_updated_at: CURRENT_UPDATED_AT,
        },
      });
      expect(documentDeliveryRuleUpdateManyMock).not.toHaveBeenCalled();
    });

    it('detects a version race at the atomic update claim', async () => {
      documentDeliveryRuleUpdateManyMock.mockResolvedValueOnce({ count: 0 });
      documentDeliveryRuleFindFirstMock
        .mockResolvedValueOnce({ updated_at: new Date(CURRENT_UPDATED_AT) })
        .mockResolvedValueOnce({ updated_at: new Date('2026-07-17T01:00:00.000Z') });

      const response = (await PATCH(
        createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, channel: 'email' }),
        routeContext(),
      ))!;

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        details: { current_updated_at: '2026-07-17T01:00:00.000Z' },
      });
    });

    it('adds no-store headers to auth failures before opening a transaction', async () => {
      authMock.mockResolvedValue(null);
      const response = (await PATCH(
        createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, channel: 'fax' }),
        routeContext(),
      ))!;

      expect(response.status).toBe(401);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('sanitizes and traces unexpected update failures', async () => {
      const rawMessage = 'database exploded while updating rules';
      const error = new Error(rawMessage);
      documentDeliveryRuleUpdateManyMock.mockRejectedValueOnce(error);

      const response = (await PATCH(
        createPatchRequest({ expected_updated_at: CURRENT_UPDATED_AT, channel: 'fax' }),
        routeContext(),
      ))!;

      await expectInternalError(response, rawMessage);
      expect(loggerErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'route_handler_unhandled_error',
          route: '/api/document-delivery-rules/rule_1',
          method: 'PATCH',
        }),
        error,
      );
    });
  });

  describe('DELETE', () => {
    it('deletes with an organization-scoped version claim in one transaction', async () => {
      const response = (await DELETE(createDeleteRequest(), routeContext()))!;

      expect(response.status).toBe(200);
      expectNoStore(response);
      expect(documentDeliveryRuleDeleteManyMock).toHaveBeenCalledWith({
        where: {
          id: 'rule_1',
          org_id: 'org_1',
          updated_at: new Date(CURRENT_UPDATED_AT),
        },
      });
      expectOrgContextBoundToRequestContext();
      await expect(response.json()).resolves.toEqual({ data: { id: 'rule_1' } });
    });

    it.each([
      ['', 'missing'],
      ['?expected_updated_at=invalid', 'invalid'],
      [
        `?expected_updated_at=${encodeURIComponent(CURRENT_UPDATED_AT)}&expected_updated_at=${encodeURIComponent(STALE_UPDATED_AT)}`,
        'duplicate',
      ],
    ])('rejects %s version query values before opening a transaction', async (query) => {
      const response = (await DELETE(createDeleteRequest(query), routeContext()))!;

      expect(response.status).toBe(400);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(documentDeliveryRuleDeleteManyMock).not.toHaveBeenCalled();
    });

    it('returns a typed conflict without deleting a stale rule', async () => {
      const response = (await DELETE(
        createDeleteRequest(`?expected_updated_at=${encodeURIComponent(STALE_UPDATED_AT)}`),
        routeContext(),
      ))!;

      expect(response.status).toBe(409);
      expectNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        details: {
          conflict_type: 'stale_document_delivery_rule',
          current_updated_at: CURRENT_UPDATED_AT,
        },
      });
      expect(documentDeliveryRuleDeleteManyMock).not.toHaveBeenCalled();
    });

    it('detects a version race at the atomic delete claim', async () => {
      documentDeliveryRuleDeleteManyMock.mockResolvedValueOnce({ count: 0 });
      documentDeliveryRuleFindFirstMock
        .mockResolvedValueOnce({ id: 'rule_1', updated_at: new Date(CURRENT_UPDATED_AT) })
        .mockResolvedValueOnce(null);

      const response = (await DELETE(createDeleteRequest(), routeContext()))!;

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        details: { current_updated_at: null },
      });
    });

    it('returns 404 without deleting a missing rule', async () => {
      documentDeliveryRuleFindFirstMock.mockResolvedValueOnce(null);
      const response = (await DELETE(createDeleteRequest(), routeContext()))!;

      expect(response.status).toBe(404);
      expect(documentDeliveryRuleDeleteManyMock).not.toHaveBeenCalled();
    });

    it('adds no-store headers to auth failures before opening a transaction', async () => {
      authMock.mockResolvedValue(null);
      const response = (await DELETE(createDeleteRequest(), routeContext()))!;

      expect(response.status).toBe(401);
      expectNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('sanitizes and traces unexpected delete failures', async () => {
      const rawMessage = 'database exploded while deleting rules';
      const error = new Error(rawMessage);
      documentDeliveryRuleDeleteManyMock.mockRejectedValueOnce(error);

      const response = (await DELETE(createDeleteRequest(), routeContext()))!;

      await expectInternalError(response, rawMessage);
      expect(loggerErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'route_handler_unhandled_error',
          route: '/api/document-delivery-rules/rule_1',
          method: 'DELETE',
        }),
        error,
      );
    });
  });
});
