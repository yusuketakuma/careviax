import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  patientFindManyMock,
  interventionFindFirstMock,
  recordPhiReadAuditForRequestMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  interventionFindFirstMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>, options?: unknown) =>
    async (req: unknown, routeContext?: unknown) => {
      const authResult = await requireAuthContextMock(req, options);
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, routeContext);
    },
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
      const intervention = {
        id: 'int_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        type: 'drug_interaction',
        description: 'アムロジピンの相互作用を確認',
      };
      interventionFindFirstMock.mockResolvedValue(intervention);

      const req = createRequest('http://localhost/api/interventions/int_1');
      const res = await GET(req, { params: Promise.resolve({ id: 'int_1' }) });
      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      expect(requireAuthContextMock).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.objectContaining({
          permission: 'canVisit',
          message: '介入記録の閲覧権限がありません',
        }),
      );
      // org-wide role (pharmacist) bypasses assignment scoping: no patient-assignment lookup.
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(interventionFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'int_1',
          org_id: 'org_1',
        },
      });
      const json = await res!.json();
      expect(json.data.id).toBe('int_1');
      expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
        {
          patientId: 'patient_1',
          targetType: 'intervention',
          targetId: 'int_1',
          view: 'intervention_detail',
        },
      );
      expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
      const auditPayload = JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls[0]?.[1]);
      expect(auditPayload).not.toContain('アムロジピン');
    });

    it('returns 404 when intervention not found', async () => {
      interventionFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/interventions/missing');
      const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
      expectSensitiveNoStore(res!);
      expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    });

    it('returns 404 for an org-wide role when the intervention is not in the org', async () => {
      patientFindManyMock.mockResolvedValue([]);
      interventionFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/interventions/int_1');
      const res = await GET(req, { params: Promise.resolve({ id: 'int_1' }) });

      expect(res!.status).toBe(404);
      expectSensitiveNoStore(res!);
      // org-wide role (pharmacist) bypasses assignment scoping: org-only lookup, no patient filter.
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(interventionFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'int_1',
          org_id: 'org_1',
        },
      });
      expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    });

    it('rejects blank intervention ids before assignment lookup or intervention reads', async () => {
      const req = createRequest('http://localhost/api/interventions/int_1');
      const res = await GET(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '介入記録IDが不正です',
      });
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(interventionFindFirstMock).not.toHaveBeenCalled();
      expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    });

    it('returns a fixed no-store 500 without auditing when the detail read fails', async () => {
      interventionFindFirstMock.mockRejectedValueOnce(
        new Error('患者 山田花子 raw intervention アムロジピン detail'),
      );

      const req = createRequest('http://localhost/api/interventions/int_1');
      const res = await GET(req, { params: Promise.resolve({ id: 'int_1' }) });

      expect(res!.status).toBe(500);
      expectSensitiveNoStore(res!);
      const body = await res!.json();
      expect(body).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'サーバー内部でエラーが発生しました',
      });
      expect(JSON.stringify(body)).not.toContain('山田花子');
      expect(JSON.stringify(body)).not.toContain('アムロジピン');
      expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    });

    it('does not read or audit intervention detail when authentication is rejected', async () => {
      requireAuthContextMock.mockResolvedValueOnce({
        response: new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }),
      });

      const req = createRequest('http://localhost/api/interventions/int_1');
      const res = await GET(req, { params: Promise.resolve({ id: 'int_1' }) });

      expect(res!.status).toBe(401);
      expectSensitiveNoStore(res!);
      expect(patientFindManyMock).not.toHaveBeenCalled();
      expect(interventionFindFirstMock).not.toHaveBeenCalled();
      expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
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
      expect(requireAuthContextMock).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.objectContaining({
          permission: 'canVisit',
          message: '介入記録の更新権限がありません',
        }),
      );
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
