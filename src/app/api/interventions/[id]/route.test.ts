import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindManyMock,
  interventionFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  interventionFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: patientFindManyMock,
    },
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
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'PATCH',
    ...(body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
  });
}

function createBadJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: '{bad json',
  });
}

const authCtx = {
  ctx: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  },
};

describe('/api/interventions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1' }]);
  });

  describe('GET', () => {
    it('returns 200 with intervention data', async () => {
      const intervention = { id: 'int_1', org_id: 'org_1', type: 'drug_interaction' };
      interventionFindFirstMock.mockResolvedValue(intervention);

      const req = createRequest('http://localhost/api/interventions/int_1');
      const res = await GET(req, { params: Promise.resolve({ id: 'int_1' }) });
      expect(res!.status).toBe(200);
      expect(patientFindManyMock).toHaveBeenCalledWith({
        where: {
          org_id: 'org_1',
          AND: [
            {
              cases: {
                some: {
                  OR: [
                    { primary_pharmacist_id: 'user_1' },
                    { backup_pharmacist_id: 'user_1' },
                    { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                  ],
                },
              },
            },
          ],
        },
        select: { id: true },
      });
      expect(interventionFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'int_1',
          org_id: 'org_1',
          AND: [{ patient_id: { in: ['patient_1'] } }],
        },
      });
      const json = await res!.json();
      expect(json.data.id).toBe('int_1');
    });

    it('returns 404 when intervention not found', async () => {
      interventionFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/interventions/missing');
      const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
    });

    it('returns 404 when the user has no assigned patients', async () => {
      patientFindManyMock.mockResolvedValue([]);
      interventionFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/interventions/int_1');
      const res = await GET(req, { params: Promise.resolve({ id: 'int_1' }) });

      expect(res!.status).toBe(404);
      expect(interventionFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'int_1',
          org_id: 'org_1',
          AND: [{ patient_id: { in: [] } }],
        },
      });
    });

    it('rejects blank intervention ids before assignment lookup or intervention reads', async () => {
      const req = createRequest('http://localhost/api/interventions/int_1');
      const res = await GET(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '介入記録IDが不正です',
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(interventionFindFirstMock).not.toHaveBeenCalled();
    });
  });

  describe('PATCH', () => {
    it('rejects non-object patch payloads before loading the intervention', async () => {
      const req = createRequest('http://localhost/api/interventions/int_1', []);
      const res = await PATCH(req, { params: Promise.resolve({ id: 'int_1' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(interventionFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('rejects blank intervention ids before parsing or updating the intervention', async () => {
      const req = createRequest('http://localhost/api/interventions/int_1', {
        intervention_type: 'dosage_adjustment',
        note: 'Updated',
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '介入記録IDが不正です',
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(interventionFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns 200 on valid update', async () => {
      interventionFindFirstMock.mockResolvedValue({ id: 'int_1' });
      const updated = { id: 'int_1', intervention_type: 'dosage_adjustment', note: 'Updated' };
      withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
        fn({ intervention: { update: vi.fn().mockResolvedValue(updated) } }),
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

    it('rejects malformed JSON patch payloads before loading the intervention', async () => {
      const req = createBadJsonRequest('http://localhost/api/interventions/int_1');
      const res = await PATCH(req, { params: Promise.resolve({ id: 'int_1' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        message: 'リクエストボディが不正です',
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(interventionFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });
  });
});
