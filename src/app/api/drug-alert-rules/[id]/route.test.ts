import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
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
  return {
    url,
    method: body === undefined ? 'DELETE' : 'PATCH',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
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
          update: vi.fn().mockResolvedValue({ id: 'rule_1', severity: 'warning', is_active: true }),
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
        }),
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(200);
    });

    it('returns 400 with invalid body', async () => {
      const response = (await PATCH(
        {
          url: 'http://localhost/api/drug-alert-rules/rule_1',
          method: 'PATCH',
          headers: { get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null) },
          nextUrl: new URL('http://localhost/api/drug-alert-rules/rule_1'),
          json: vi.fn().mockRejectedValue(new Error('bad json')),
        } as unknown as NextRequest,
        { params: Promise.resolve({ id: 'rule_1' }) },
      ))!;

      expect(response.status).toBe(400);
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
