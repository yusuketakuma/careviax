import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  interventionFindManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  interventionFindManyMock: vi.fn(),
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
    intervention: {
      findMany: interventionFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/interventions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    interventionFindManyMock.mockResolvedValue([
      {
        id: 'int_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        issue_id: null,
        type: 'dose_adjustment',
        description: '用量調整',
        outcome: null,
        performed_by: 'user_1',
        performed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        intervention: {
          create: vi.fn().mockResolvedValue({
            id: 'int_2',
            patient_id: 'patient_1',
            type: 'dose_adjustment',
            description: '用量調整',
            performed_by: 'user_1',
            performed_at: new Date(),
          }),
        },
      }),
    );
  });

  describe('GET', () => {
    it('returns 200 with interventions', async () => {
      const response = (await GET(createRequest('http://localhost/api/interventions?patient_id=patient_1')))!;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toHaveLength(1);
    });
  });

  describe('POST', () => {
    it('returns 201 when creating an intervention', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/interventions', {
          patient_id: 'patient_1',
          type: 'dose_adjustment',
          description: '用量調整',
          performed_at: '2026-04-01T10:00:00.000Z',
        }),
      ))!;

      expect(response.status).toBe(201);
    });

    it('returns 400 with invalid body', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/interventions', {
          patient_id: '',
        }),
      ))!;

      expect(response.status).toBe(400);
    });
  });
});
