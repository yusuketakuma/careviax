import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitRecordFindFirstMock,
  patientFindFirstMock,
  processHandoffExtractionMock,
  VisitHandoffStaleRecordErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  processHandoffExtractionMock: vi.fn(),
  VisitHandoffStaleRecordErrorMock: class VisitHandoffStaleRecordError extends Error {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
    patient: { findFirst: patientFindFirstMock },
  },
}));

vi.mock('@/server/services/visit-handoff', () => ({
  processHandoffExtraction: processHandoffExtractionMock,
  VisitHandoffStaleRecordError: VisitHandoffStaleRecordErrorMock,
}));

import { POST } from './route';

function createRequest(url: string) {
  return new NextRequest(url, { method: 'POST' });
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

describe('/api/visit-records/[id]/handoff/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
  });

  it('returns 201 on successful extraction', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      soap_assessment: 'assessment',
      soap_plan: 'plan',
      structured_soap: { subjective: {}, objective: {} },
      version: 2,
    });
    patientFindFirstMock.mockResolvedValue({ name: 'Taro' });
    const handoff = { next_check_items: ['check1'] };
    processHandoffExtractionMock.mockResolvedValue(handoff);

    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'vr_1' }) });
    expect(res!.status).toBe(201);
    expect(processHandoffExtractionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        visitRecordId: 'vr_1',
        expectedVersion: 2,
      }),
    );
  });

  it('rejects blank visit record ids before loading or extracting handoff data', async () => {
    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: '   ' }) });

    expect(res!.status).toBe(400);
    await expect(res!.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問記録IDが不正です',
    });
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(processHandoffExtractionMock).not.toHaveBeenCalled();
  });

  it('returns 404 when visit record not found', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const req = createRequest('http://localhost/api/visit-records/missing/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res!.status).toBe(404);
  });

  it('returns 422 when no structured SOAP data', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      soap_assessment: null,
      soap_plan: null,
      structured_soap: null,
    });

    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'vr_1' }) });
    expect(res!.status).toBe(422);
  });

  it('returns conflict when the visit record changes before extraction is persisted', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      soap_assessment: 'assessment',
      soap_plan: 'plan',
      structured_soap: { subjective: {}, objective: {} },
      version: 2,
    });
    patientFindFirstMock.mockResolvedValue({ name: 'Taro' });
    processHandoffExtractionMock.mockRejectedValue(new VisitHandoffStaleRecordErrorMock('stale'));

    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'vr_1' }) });

    expect(res!.status).toBe(409);
    await expect(res!.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問記録が更新されています。再読み込みしてから申し送り抽出をやり直してください',
    });
  });
});
