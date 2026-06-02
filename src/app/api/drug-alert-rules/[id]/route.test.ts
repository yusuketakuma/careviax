import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, drugAlertRuleUpdateMock, withOrgContextMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    drugAlertRuleUpdateMock: vi.fn(),
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

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'DELETE' : 'PATCH',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-org-id': 'org_1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createBadJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{bad json',
  });
}

describe('/api/drug-alert-rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        drugAlertRule: {
          findFirst: vi.fn().mockResolvedValue({ id: 'rule_1' }),
          update: drugAlertRuleUpdateMock.mockResolvedValue({
            id: 'rule_1',
            severity: 'warning',
            is_active: true,
          }),
          delete: vi.fn().mockResolvedValue({ id: 'rule_1' }),
        },
      }),
    );
  });

  describe('PATCH', () => {
    it('returns 200 when updating an alert rule', async () => {
      const response = (await PATCH(
        createRequest('http://localhost/api/drug-alert-rules/rule_1', {
          severity: 'warning',
          is_active: true,
          condition: {
            severity_floor: 'warning',
            omitted: undefined,
            fallback: null,
            thresholds: [1, undefined],
          },
        }),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(200);
      expect(drugAlertRuleUpdateMock).toHaveBeenCalledWith({
        where: { id: 'rule_1' },
        data: expect.objectContaining({
          severity: 'warning',
          is_active: true,
          condition: {
            severity_floor: 'warning',
            fallback: null,
            thresholds: [1, null],
          },
        }),
      });
    });

    it('rejects malformed JSON update payloads before loading the alert rule', async () => {
      const response = (await PATCH(
        createBadJsonRequest('http://localhost/api/drug-alert-rules/rule_1'),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(drugAlertRuleUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects non-object update payloads before loading the alert rule', async () => {
      const response = (await PATCH(
        createRequest('http://localhost/api/drug-alert-rules/rule_1', []),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(drugAlertRuleUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects blank route ids before loading the alert rule', async () => {
      const response = (await PATCH(
        createRequest('http://localhost/api/drug-alert-rules/%20%20%20', {
          severity: 'warning',
        }),
        { params: Promise.resolve({ id: '   ' }) },
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '処方安全アラートルールIDが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(drugAlertRuleUpdateMock).not.toHaveBeenCalled();
    });

    it('returns 404 when rule not found', async () => {
      withOrgContextMock.mockImplementation(async (_orgId, callback) =>
        callback({
          drugAlertRule: {
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn(),
          },
        }),
      );

      const response = (await PATCH(
        createRequest('http://localhost/api/drug-alert-rules/nonexistent', {
          severity: 'info',
        }),
        { params: Promise.resolve({ id: 'nonexistent' }) },
      ))!;

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE', () => {
    it('returns 200 when deleting an alert rule', async () => {
      const response = (await DELETE(
        createRequest('http://localhost/api/drug-alert-rules/rule_1'),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(200);
    });

    it('rejects blank route ids before loading the alert rule', async () => {
      const response = (await DELETE(
        createRequest('http://localhost/api/drug-alert-rules/%20%20%20'),
        { params: Promise.resolve({ id: '   ' }) },
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '処方安全アラートルールIDが不正です',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns 404 when rule not found', async () => {
      withOrgContextMock.mockImplementation(async (_orgId, callback) =>
        callback({
          drugAlertRule: {
            findFirst: vi.fn().mockResolvedValue(null),
            delete: vi.fn(),
          },
        }),
      );

      const response = (await DELETE(
        createRequest('http://localhost/api/drug-alert-rules/nonexistent'),
        { params: Promise.resolve({ id: 'nonexistent' }) },
      ))!;

      expect(response.status).toBe(404);
    });
  });
});
