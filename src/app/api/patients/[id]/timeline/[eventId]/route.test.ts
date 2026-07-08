import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  getPatientMovementTimelineEventDetailMock,
  createScopedTxRunnerMock,
  fakeRunner,
  authContextMock,
  authRejectionMock,
  recordPhiReadAuditForRequestMock,
  randomUUIDMock,
} = vi.hoisted(() => {
  const runner = vi.fn();
  return {
    getPatientMovementTimelineEventDetailMock: vi.fn(),
    createScopedTxRunnerMock: vi.fn(() => runner),
    fakeRunner: runner,
    authContextMock: vi.fn(() => ({
      orgId: 'org_1',
      role: 'pharmacist',
      userId: 'user_1',
    })),
    authRejectionMock: vi.fn<() => Response | null>(() => null),
    recordPhiReadAuditForRequestMock: vi.fn(),
    randomUUIDMock: vi.fn(() => 'generated-movement-request-id'),
  };
});

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    randomUUID: randomUUIDMock,
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (req: Request, routeContext: { params: Promise<{ id: string; eventId: string }> }) => {
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);
      return handler(req, authContextMock(), routeContext);
    },
}));

vi.mock('@/lib/db/rls', () => ({
  createScopedTxRunner: createScopedTxRunnerMock,
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientMovementTimelineEventDetail: getPatientMovementTimelineEventDetailMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

import { GET } from './route';

function createRequest(
  url = 'http://localhost/api/patients/patient_1/timeline/visit_record%3Avisit_1?purpose=care&read_reason=review_movement_detail&request_id=req_mov_1',
) {
  return new NextRequest(url);
}

function buildMovementDetail() {
  return {
    patient_id: 'patient_1',
    event_id: 'visit_record:visit_1',
    event: {
      id: 'visit_record:visit_1',
      event_type: 'visit_event',
      category: 'visit',
      occurred_at: '2026-07-07T01:00:00.000Z',
      recorded_at: null,
      title: '訪問記録を保存',
      summary: '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。',
      href: '/visits/visit_1',
      action_label: '訪問記録を開く',
      status: 'completed',
      status_label: '完了',
      actor_name: '佐藤 薬剤師',
      actor_role: null,
      source_channel: null,
      source_label: null,
      related_entity_type: 'visit_record',
      related_entity_id: 'visit_1',
      severity: 'normal',
      badges: [{ label: '完了', tone: 'success' }],
      metadata: [],
      privacy_level: 'summary',
      raw_available: false,
    },
    destination: {
      href: '/visits/visit_1',
      label: '訪問記録を開く',
      related_entity_type: 'visit_record',
      related_entity_id: 'visit_1',
    },
    raw_text: {
      available: false,
      included: false,
      reason: 'このイベントの raw_text は resolver では提供しません。',
    },
  };
}

describe('GET /api/patients/[id]/timeline/[eventId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue({ orgId: 'org_1', role: 'pharmacist', userId: 'user_1' });
    authRejectionMock.mockReturnValue(null);
    createScopedTxRunnerMock.mockReturnValue(fakeRunner);
    randomUUIDMock.mockReturnValue('generated-movement-request-id');
  });

  it('returns a movement-safe data/meta detail after purpose/read-reason reauthorization', async () => {
    getPatientMovementTimelineEventDetailMock.mockResolvedValue(buildMovementDetail());

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1', eventId: 'visit_record:visit_1' }),
    });

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('x-request-id')).toBe('req_mov_1');
    expect(createScopedTxRunnerMock).toHaveBeenCalledWith('org_1');
    expect(getPatientMovementTimelineEventDetailMock).toHaveBeenCalledWith(fakeRunner, {
      orgId: 'org_1',
      patientId: 'patient_1',
      eventId: 'visit_record:visit_1',
      role: 'pharmacist',
      userId: 'user_1',
    });

    const json = await response.json();
    expect(json).toMatchObject({
      data: {
        patient_id: 'patient_1',
        event_id: 'visit_record:visit_1',
        destination: { href: '/visits/visit_1' },
        raw_text: { included: false },
      },
      meta: {
        request_id: 'req_mov_1',
        purpose: 'care',
        read_reason: 'review_movement_detail',
        raw_text_included: false,
      },
    });
    expect(json.patient_id).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('SOAP本文');
    expect(JSON.stringify(json)).not.toContain('storage_key');
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      { orgId: 'org_1', role: 'pharmacist', userId: 'user_1' },
      expect.objectContaining({
        patientId: 'patient_1',
        targetType: 'patient_movement_timeline_event',
        targetId: 'visit_record:visit_1',
        view: 'patient_timeline_event',
        purpose: 'care',
        metadata: expect.objectContaining({
          route: '/api/patients/[id]/timeline/[eventId]',
          request_id: 'req_mov_1',
          read_reason_code: 'review_movement_detail',
          event_id: 'visit_record:visit_1',
          category: 'visit',
          raw_available: false,
        }),
      }),
    );
    const auditPayload = JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls[0]?.[1]);
    expect(auditPayload).not.toContain('訪問記録を保存');
    expect(auditPayload).not.toContain('佐藤 薬剤師');
    expect(auditPayload).not.toContain('/visits/visit_1');
    expect(auditPayload).not.toContain('related_entity_id');
  });

  it('generates a safe request id when omitted', async () => {
    getPatientMovementTimelineEventDetailMock.mockResolvedValue(buildMovementDetail());

    const response = await GET(
      createRequest(
        'http://localhost/api/patients/patient_1/timeline/visit_record%3Avisit_1?purpose=medication_review&read_reason=medication_history_review',
      ),
      {
        params: Promise.resolve({ id: 'patient_1', eventId: 'visit_record:visit_1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('generated-movement-request-id');
    const json = await response.json();
    expect(json.meta.request_id).toBe('generated-movement-request-id');
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        purpose: 'medication_review',
        metadata: expect.objectContaining({
          request_id: 'generated-movement-request-id',
          read_reason_code: 'medication_history_review',
        }),
      }),
    );
  });

  it.each([
    [
      'missing purpose',
      'http://localhost/api/patients/patient_1/timeline/visit_record%3Avisit_1?read_reason=review_movement_detail',
    ],
    [
      'invalid purpose',
      'http://localhost/api/patients/patient_1/timeline/visit_record%3Avisit_1?purpose=free_text&read_reason=review_movement_detail',
    ],
    [
      'missing read reason',
      'http://localhost/api/patients/patient_1/timeline/visit_record%3Avisit_1?purpose=care',
    ],
    [
      'invalid read reason',
      'http://localhost/api/patients/patient_1/timeline/visit_record%3Avisit_1?purpose=care&read_reason=raw_text_needed',
    ],
    [
      'invalid request id',
      'http://localhost/api/patients/patient_1/timeline/visit_record%3Avisit_1?purpose=care&read_reason=review_movement_detail&request_id=raw text',
    ],
  ])('rejects %s before reading or auditing detail', async (_label, url) => {
    const response = await GET(createRequest(url), {
      params: Promise.resolve({ id: 'patient_1', eventId: 'visit_record:visit_1' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientMovementTimelineEventDetailMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('rejects invalid route params before parsing the detail query or creating the scoped runner', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '..', eventId: 'visit_record:visit_1' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientMovementTimelineEventDetailMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns 404 without auditing when the event is not visible in the movement timeline', async () => {
    getPatientMovementTimelineEventDetailMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1', eventId: 'missing:event' }),
    });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('keeps auth rejections no-store and does not access detail data', async () => {
    authRejectionMock.mockReturnValue(
      NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1', eventId: 'visit_record:visit_1' }),
    });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientMovementTimelineEventDetailMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
