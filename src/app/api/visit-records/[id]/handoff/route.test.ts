import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  canAccessVisitScheduleAssignmentMock,
  visitRecordFindFirstMock,
  visitHandoffExtractionFindUniqueMock,
  confirmHandoffMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  canAccessVisitScheduleAssignmentMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  visitHandoffExtractionFindUniqueMock: vi.fn(),
  confirmHandoffMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  canAccessVisitScheduleAssignment: canAccessVisitScheduleAssignmentMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
    visitHandoffExtraction: { findUnique: visitHandoffExtractionFindUniqueMock },
  },
}));

vi.mock('@/server/services/visit-handoff', () => ({
  confirmHandoff: confirmHandoffMock,
  VisitHandoffStaleRecordError: class VisitHandoffStaleRecordError extends Error {},
  VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE:
    '申し送り抽出に失敗しました。時間をおいて再実行してください',
}));

import { GET, PUT } from './route';
import { VisitHandoffStaleRecordError } from '@/server/services/visit-handoff';

function createRequest(url: string, body?: unknown) {
  if (body === undefined) {
    return new NextRequest(url);
  }
  return new NextRequest(url, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'PUT',
    body: '{"confirmed":',
    headers: { 'content-type': 'application/json' },
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

const accessibleSchedule = {
  pharmacist_id: 'user_1',
  case_: {
    primary_pharmacist_id: 'user_1',
    backup_pharmacist_id: null,
  },
};

const VISIT_RECORD_VERSION = 2;
const VISIT_RECORD_UPDATED_AT = new Date('2026-04-01T00:00:00.000Z');
const VISIT_RECORD_UPDATED_AT_ISO = VISIT_RECORD_UPDATED_AT.toISOString();

function buildVisitRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vr_1',
    version: VISIT_RECORD_VERSION,
    updated_at: VISIT_RECORD_UPDATED_AT,
    schedule: accessibleSchedule,
    structured_soap: {
      handoff: { next_check_items: ['item1'], ongoing_monitoring: [] },
    },
    ...overrides,
  };
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/visit-records/[id]/handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    canAccessVisitScheduleAssignmentMock.mockReturnValue(true);
    visitHandoffExtractionFindUniqueMock.mockResolvedValue(null);
  });

  describe('GET', () => {
    it('adds no-store headers to auth failures', async () => {
      requireAuthContextMock.mockResolvedValue({
        response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    });

    it('returns 200 with handoff data', async () => {
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord());
      visitHandoffExtractionFindUniqueMock.mockResolvedValue({
        status: 'succeeded',
        retry_count: 0,
        last_attempted_at: new Date('2026-04-01T00:00:00.000Z'),
        last_succeeded_at: new Date('2026-04-01T00:01:00.000Z'),
        last_failed_at: null,
        error_message: null,
        retryable: false,
        source_visit_record_version: 2,
        source_visit_record_updated_at: new Date('2026-04-01T00:00:00.000Z'),
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
        authCtx.ctx,
        accessibleSchedule,
      );
      const json = await res!.json();
      expect(json.data.next_check_items).toEqual(['item1']);
      expect(json.extraction).toMatchObject({
        status: 'succeeded',
        retryable: false,
        source_visit_record_version: 2,
      });
      expect(json).toMatchObject({
        visit_record_version: VISIT_RECORD_VERSION,
        visit_record_updated_at: VISIT_RECORD_UPDATED_AT_ISO,
      });
    });

    it('rejects blank visit record ids before loading handoff data', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '訪問記録IDが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    });

    it('returns 404 when record not found', async () => {
      visitRecordFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/visit-records/missing/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
      expectSensitiveNoStore(res!);
      expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    });

    it('returns a sanitized no-store 500 when handoff lookup fails unexpectedly', async () => {
      visitRecordFindFirstMock.mockRejectedValueOnce(new Error('raw handoff secret'));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(500);
      expectSensitiveNoStore(res!);
      const bodyText = await res!.text();
      expect(bodyText).toContain('INTERNAL_ERROR');
      expect(bodyText).not.toContain('raw handoff secret');
    });

    it('returns 403 before reading extraction state when assignment access is denied', async () => {
      canAccessVisitScheduleAssignmentMock.mockReturnValue(false);
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord());

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
        authCtx.ctx,
        accessibleSchedule,
      );
      expect(visitHandoffExtractionFindUniqueMock).not.toHaveBeenCalled();
    });

    it('returns 404 when no handoff data', async () => {
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord({ structured_soap: null }));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(404);
      expectSensitiveNoStore(res!);
    });

    it('returns redacted extraction status even when handoff data is not yet available', async () => {
      visitRecordFindFirstMock.mockResolvedValue(buildVisitRecord({ structured_soap: null }));
      visitHandoffExtractionFindUniqueMock.mockResolvedValue({
        status: 'failed',
        retry_count: 2,
        last_attempted_at: new Date('2026-04-01T00:00:00.000Z'),
        last_succeeded_at: null,
        last_failed_at: new Date('2026-04-01T00:00:30.000Z'),
        error_message: 'patient=田中太郎 SOAP=服薬状況 token=secret',
        retryable: true,
        source_visit_record_version: 2,
        source_visit_record_updated_at: new Date('2026-04-01T00:00:00.000Z'),
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      const payload = await res!.json();
      expect(payload).toMatchObject({
        data: null,
        extraction: {
          status: 'failed',
          retry_count: 2,
          error_message: '申し送り抽出に失敗しました。時間をおいて再実行してください',
          retryable: true,
        },
      });
      const payloadText = JSON.stringify(payload);
      expect(payloadText).not.toContain('田中太郎');
      expect(payloadText).not.toContain('SOAP=服薬状況');
      expect(payloadText).not.toContain('token=secret');
    });
  });

  describe('PUT', () => {
    it('adds no-store headers to auth failures', async () => {
      requireAuthContextMock.mockResolvedValue({
        response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns 200 on valid handoff confirmation', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: {} } }),
      );
      const handoffResult = { confirmed: true, confirmed_by: 'user_1' };
      confirmHandoffMock.mockResolvedValue(handoffResult);

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(200);
      expectSensitiveNoStore(res!);
      expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
        authCtx.ctx,
        accessibleSchedule,
      );
      expect(confirmHandoffMock).toHaveBeenCalledWith(expect.anything(), {
        orgId: 'org_1',
        visitRecordId: 'vr_1',
        confirmedBy: 'user_1',
        expectedVersion: VISIT_RECORD_VERSION,
        edits: undefined,
        requestContext: authCtx.ctx,
      });
    });

    it('rejects blank visit record ids before confirming handoff data', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '訪問記録IDが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns 400 on invalid body', async () => {
      const req = createMalformedJsonRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'リクエストボディが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('rejects non-object confirmation payloads before loading the visit record', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', ['confirmed']);

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'リクエストボディが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('rejects schema-invalid confirmation payloads before loading the visit record', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: false,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns 403 before confirming handoff data when assignment access is denied', async () => {
      canAccessVisitScheduleAssignmentMock.mockReturnValue(false);
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: {} } }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
        authCtx.ctx,
        accessibleSchedule,
      );
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('requires the visit record version before loading the visit record for confirmation', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(400);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
        details: {
          expected_visit_record_version: expect.any(Array),
        },
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns conflict for stale visit record versions before confirming handoff data', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ version: VISIT_RECORD_VERSION + 1, structured_soap: { handoff: {} } }),
      );

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(409);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '訪問記録が同時に更新されました。再読み込みしてください',
      });
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('maps lost service-level confirmation claims to a sanitized conflict', async () => {
      visitRecordFindFirstMock.mockResolvedValue(
        buildVisitRecord({ structured_soap: { handoff: {} } }),
      );
      confirmHandoffMock.mockRejectedValueOnce(new VisitHandoffStaleRecordError('vr_1'));

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
        expected_visit_record_version: VISIT_RECORD_VERSION,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(409);
      expectSensitiveNoStore(res!);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '訪問記録が同時に更新されました。再読み込みしてください',
      });
    });
  });
});
