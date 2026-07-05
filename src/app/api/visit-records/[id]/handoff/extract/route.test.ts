import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  canAccessVisitScheduleAssignmentMock,
  selectVisitHandoffConfirmationAssigneeMock,
  visitRecordFindFirstMock,
  patientFindFirstMock,
  processHandoffExtractionMock,
  VisitHandoffStaleRecordErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  canAccessVisitScheduleAssignmentMock: vi.fn(),
  selectVisitHandoffConfirmationAssigneeMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  processHandoffExtractionMock: vi.fn(),
  VisitHandoffStaleRecordErrorMock: class VisitHandoffStaleRecordError extends Error {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  canAccessVisitScheduleAssignment: canAccessVisitScheduleAssignmentMock,
  selectVisitHandoffConfirmationAssignee: selectVisitHandoffConfirmationAssigneeMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
    patient: { findFirst: patientFindFirstMock },
  },
}));

vi.mock('@/server/services/visit-handoff', () => ({
  processHandoffExtraction: processHandoffExtractionMock,
  VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE:
    '申し送り抽出に失敗しました。時間をおいて再実行してください',
  VisitHandoffStaleRecordError: VisitHandoffStaleRecordErrorMock,
}));

import { POST } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

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

const accessibleSchedule = {
  pharmacist_id: 'user_1',
  case_: {
    primary_pharmacist_id: 'user_1',
    backup_pharmacist_id: null,
  },
};

describe('/api/visit-records/[id]/handoff/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    canAccessVisitScheduleAssignmentMock.mockReturnValue(true);
    selectVisitHandoffConfirmationAssigneeMock.mockReturnValue('user_1');
  });

  it('returns 201 on successful extraction', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      soap_assessment: 'assessment',
      soap_plan: 'plan',
      structured_soap: { subjective: {}, objective: {} },
      version: 2,
      schedule: accessibleSchedule,
    });
    patientFindFirstMock.mockResolvedValue({ name: 'Taro' });
    const handoff = { next_check_items: ['check1'] };
    processHandoffExtractionMock.mockResolvedValue(handoff);

    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'vr_1' }) });
    expect(res!.status).toBe(201);
    expectSensitiveNoStore(res!);
    expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
      authCtx.ctx,
      accessibleSchedule,
    );
    expect(processHandoffExtractionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        visitRecordId: 'vr_1',
        expectedVersion: 2,
        handoffConfirmationAssigneeId: 'user_1',
      }),
    );
  });

  it('rejects blank visit record ids before loading or extracting handoff data', async () => {
    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: '   ' }) });

    expect(res!.status).toBe(400);
    expectSensitiveNoStore(res!);
    await expect(res!.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問記録IDが不正です',
    });
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(processHandoffExtractionMock).not.toHaveBeenCalled();
  });

  it('returns 404 when visit record not found', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const req = createRequest('http://localhost/api/visit-records/missing/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res!.status).toBe(404);
    expectSensitiveNoStore(res!);
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
  });

  it('returns 403 before loading patient data or extracting when assignment access is denied', async () => {
    canAccessVisitScheduleAssignmentMock.mockReturnValue(false);
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      soap_assessment: 'assessment',
      soap_plan: 'plan',
      structured_soap: {
        subjective: { free_text: '患者秘匿情報' },
        objective: { medication_status: 'full_compliance' },
      },
      version: 2,
      schedule: accessibleSchedule,
    });

    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'vr_1' }) });

    expect(res!.status).toBe(403);
    expectSensitiveNoStore(res!);
    expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
      authCtx.ctx,
      accessibleSchedule,
    );
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(processHandoffExtractionMock).not.toHaveBeenCalled();
    const payload = await res!.json();
    expect(JSON.stringify(payload)).not.toContain('患者秘匿情報');
  });

  it('returns 422 when no structured SOAP data', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      soap_assessment: null,
      soap_plan: null,
      structured_soap: null,
      schedule: accessibleSchedule,
    });

    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'vr_1' }) });
    expect(res!.status).toBe(422);
    expectSensitiveNoStore(res!);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns conflict when the visit record changes before extraction is persisted', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      soap_assessment: 'assessment',
      soap_plan: 'plan',
      structured_soap: { subjective: {}, objective: {} },
      version: 2,
      schedule: accessibleSchedule,
    });
    patientFindFirstMock.mockResolvedValue({ name: 'Taro' });
    processHandoffExtractionMock.mockRejectedValue(new VisitHandoffStaleRecordErrorMock('stale'));

    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'vr_1' }) });

    expect(res!.status).toBe(409);
    expectSensitiveNoStore(res!);
    await expect(res!.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問記録が更新されています。再読み込みしてから申し送り抽出をやり直してください',
    });
  });

  it('returns a generic extraction error without exposing raw failure details', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      soap_assessment: 'assessment',
      soap_plan: 'plan',
      structured_soap: { subjective: {}, objective: {} },
      version: 2,
      schedule: accessibleSchedule,
    });
    patientFindFirstMock.mockResolvedValue({ name: 'Taro' });
    processHandoffExtractionMock.mockRejectedValue(
      new Error('patient=田中太郎 SOAP=服薬状況 token=secret'),
    );

    const req = createRequest('http://localhost/api/visit-records/vr_1/handoff/extract');
    const res = await POST(req, { params: Promise.resolve({ id: 'vr_1' }) });

    expect(res!.status).toBe(500);
    expectSensitiveNoStore(res!);
    const payload = await res!.json();
    expect(payload).toMatchObject({
      code: 'extraction_failed',
      message: '申し送り抽出に失敗しました。時間をおいて再実行してください',
      details: {
        extraction: { status: 'failed', retryable: true },
      },
    });
    expect(JSON.stringify(payload)).not.toContain('田中太郎');
    expect(JSON.stringify(payload)).not.toContain('SOAP=服薬状況');
    expect(JSON.stringify(payload)).not.toContain('token=secret');
  });
});
