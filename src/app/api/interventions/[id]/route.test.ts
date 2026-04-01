import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  interventionFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  interventionFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    intervention: {
      findFirst: interventionFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'PATCH',
    headers: { get: () => null },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist', ipAddress: '127.0.0.1', userAgent: 'test' },
};

describe('/api/interventions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
  });

  describe('GET', () => {
    it('returns 200 with intervention data', async () => {
      const intervention = { id: 'int_1', org_id: 'org_1', type: 'drug_interaction' };
      interventionFindFirstMock.mockResolvedValue(intervention);

      const req = createRequest('http://localhost/api/interventions/int_1');
      const res = await GET(req, { params: Promise.resolve({ id: 'int_1' }) });
      expect(res!.status).toBe(200);
      const json = await res!.json();
      expect(json.data.id).toBe('int_1');
    });

    it('returns 404 when intervention not found', async () => {
      interventionFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/interventions/missing');
      const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
    });
  });

  describe('PATCH', () => {
    it('returns 200 on valid update', async () => {
      interventionFindFirstMock.mockResolvedValue({ id: 'int_1' });
      const updated = { id: 'int_1', intervention_type: 'dosage_adjustment', note: 'Updated' };
      withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
        fn({ intervention: { update: vi.fn().mockResolvedValue(updated) } })
      );

      const req = createRequest('http://localhost/api/interventions/int_1', {
        intervention_type: 'dosage_adjustment',
        note: 'Updated',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'int_1' }) });
      expect(res!.status).toBe(200);
      const json = await res!.json();
      expect(json.data.id).toBe('int_1');
    });

    it('returns 400 on invalid body', async () => {
      const req = createRequest('http://localhost/api/interventions/int_1');
      // Override json to reject (simulate bad JSON)
      (req as unknown as { json: () => Promise<null> }).json = vi.fn().mockRejectedValue(new Error('bad json'));
      const res = await PATCH(req, { params: Promise.resolve({ id: 'int_1' }) });
      expect(res!.status).toBe(400);
    });
  });
});
