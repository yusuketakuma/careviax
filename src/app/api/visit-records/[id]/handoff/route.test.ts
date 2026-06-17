import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitRecordFindFirstMock,
  visitHandoffExtractionFindUniqueMock,
  confirmHandoffMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  visitHandoffExtractionFindUniqueMock: vi.fn(),
  confirmHandoffMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
    visitHandoffExtraction: { findUnique: visitHandoffExtractionFindUniqueMock },
  },
}));

vi.mock('@/server/services/visit-handoff', () => ({
  confirmHandoff: confirmHandoffMock,
}));

import { GET, PUT } from './route';

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

describe('/api/visit-records/[id]/handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    visitHandoffExtractionFindUniqueMock.mockResolvedValue(null);
  });

  describe('GET', () => {
    it('returns 200 with handoff data', async () => {
      visitRecordFindFirstMock.mockResolvedValue({
        id: 'vr_1',
        structured_soap: {
          handoff: { next_check_items: ['item1'], ongoing_monitoring: [] },
        },
      });
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
      const json = await res!.json();
      expect(json.data.next_check_items).toEqual(['item1']);
      expect(json.extraction).toMatchObject({
        status: 'succeeded',
        retryable: false,
        source_visit_record_version: 2,
      });
    });

    it('rejects blank visit record ids before loading handoff data', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '訪問記録IDが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    });

    it('returns 404 when record not found', async () => {
      visitRecordFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/visit-records/missing/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
      expect(res!.status).toBe(404);
    });

    it('returns 404 when no handoff data', async () => {
      visitRecordFindFirstMock.mockResolvedValue({
        id: 'vr_1',
        structured_soap: null,
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(404);
    });

    it('returns extraction status even when handoff data is not yet available', async () => {
      visitRecordFindFirstMock.mockResolvedValue({
        id: 'vr_1',
        structured_soap: null,
      });
      visitHandoffExtractionFindUniqueMock.mockResolvedValue({
        status: 'failed',
        retry_count: 2,
        last_attempted_at: new Date('2026-04-01T00:00:00.000Z'),
        last_succeeded_at: null,
        last_failed_at: new Date('2026-04-01T00:00:30.000Z'),
        error_message: 'model timeout',
        retryable: true,
        source_visit_record_version: 2,
        source_visit_record_updated_at: new Date('2026-04-01T00:00:00.000Z'),
      });

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await GET(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(200);
      await expect(res!.json()).resolves.toMatchObject({
        data: null,
        extraction: {
          status: 'failed',
          retry_count: 2,
          error_message: 'model timeout',
          retryable: true,
        },
      });
    });
  });

  describe('PUT', () => {
    it('returns 200 on valid handoff confirmation', async () => {
      visitRecordFindFirstMock.mockResolvedValue({
        id: 'vr_1',
        structured_soap: { handoff: {} },
      });
      const handoffResult = { confirmed: true, confirmed_by: 'user_1' };
      confirmHandoffMock.mockResolvedValue(handoffResult);

      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(200);
    });

    it('rejects blank visit record ids before confirming handoff data', async () => {
      const req = createRequest('http://localhost/api/visit-records/vr_1/handoff', {
        confirmed: true,
      });

      const res = await PUT(req, { params: Promise.resolve({ id: '   ' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '訪問記録IDが不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });

    it('returns 400 on invalid body', async () => {
      const req = createMalformedJsonRequest('http://localhost/api/visit-records/vr_1/handoff');
      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });
      expect(res!.status).toBe(400);
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
      });

      const res = await PUT(req, { params: Promise.resolve({ id: 'vr_1' }) });

      expect(res!.status).toBe(400);
      await expect(res!.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
      });
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    });
  });
});
