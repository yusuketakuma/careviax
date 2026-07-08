import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  authRejectionMock,
  findFirstMock,
  withAuthContextOptionsMock,
  withOrgContextMock,
  buildInboundCommunicationEventAssignmentWhereMock,
  recordPhiReadAuditForRequestMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authContextMock: {
    orgId: 'org_1',
    role: 'pharmacist',
    userId: 'user_1',
    actorSiteId: 'site_1',
    ipAddress: '203.0.113.10',
    userAgent: 'vitest',
  },
  authRejectionMock: vi.fn<() => Response | null>(() => null),
  findFirstMock: vi.fn(),
  withAuthContextOptionsMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  buildInboundCommunicationEventAssignmentWhereMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>, options: unknown) =>
    (req: Request, routeContext: { params: Promise<{ id?: string }> }) => {
      withAuthContextOptionsMock(options);
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);
      return handler(req, authContextMock, routeContext);
    },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/communication-request-access', () => ({
  buildInboundCommunicationEventAssignmentWhere: buildInboundCommunicationEventAssignmentWhereMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET } from './route';

function createRequest(search = '?purpose=medication_review&read_reason=medication_stock_review') {
  return new NextRequest(`http://localhost/api/communications/inbound/event_1/detail${search}`, {
    headers: { 'user-agent': 'vitest' },
  });
}

function routeContext(id = 'event_1') {
  return { params: Promise.resolve({ id }) };
}

function buildInboundEvent() {
  return {
    id: 'event_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    source_channel: 'mcs',
    sender_role: 'nurse',
    sender_name: '山田 花子',
    sender_contact: '090-0000-0000',
    sender_organization_name: '訪問看護ステーションA',
    event_type: 'medication_stock_report',
    received_at: new Date('2026-06-12T00:20:00.000Z'),
    occurred_at: new Date('2026-06-12T00:10:00.000Z'),
    raw_text: '訪問看護師 山田 090-0000-0000 湿布は残り4枚です。',
    normalized_summary: '訪問看護師から湿布残数4枚の報告',
    attachment_count: 1,
    processing_status: 'signals_extracted',
  };
}

describe('GET /api/communications/inbound/[id]/detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRejectionMock.mockReturnValue(null);
    buildInboundCommunicationEventAssignmentWhereMock.mockResolvedValue({
      OR: [{ patient_id: { in: ['patient_1'] } }],
    });
    withOrgContextMock.mockImplementation((_orgId, work) =>
      work({ inboundCommunicationEvent: { findFirst: findFirstMock } }),
    );
    findFirstMock.mockResolvedValue(buildInboundEvent());
  });

  it('returns raw detail only after purpose/read-reason reauthorization and records a PHI read audit', async () => {
    const response = await GET(
      createRequest(
        '?purpose=medication_review&read_reason=medication_stock_review&request_id=req_123',
      ),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('x-request-id')).toBe('req_123');
    expect(withAuthContextOptionsMock).toHaveBeenCalledWith({
      permission: 'canReport',
      message: '受信情報の詳細閲覧権限がありません',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({ requestContext: authContextMock }),
    );
    expect(buildInboundCommunicationEventAssignmentWhereMock).toHaveBeenCalledWith({
      db: { inboundCommunicationEvent: { findFirst: findFirstMock } },
      orgId: 'org_1',
      accessContext: { role: 'pharmacist', userId: 'user_1' },
    });
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'event_1',
          org_id: 'org_1',
          AND: [{ OR: [{ patient_id: { in: ['patient_1'] } }] }],
        }),
        select: expect.objectContaining({
          raw_text: true,
          sender_contact: true,
          normalized_summary: true,
        }),
      }),
    );

    const json = await response.json();
    expect(json).toMatchObject({
      data: {
        id: 'event_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        source_channel: 'mcs',
        sender_role: 'nurse',
        sender_contact: '090-0000-0000',
        raw_text: '訪問看護師 山田 090-0000-0000 湿布は残り4枚です。',
        normalized_summary: '訪問看護師から湿布残数4枚の報告',
        attachment_count: 1,
      },
      meta: {
        request_id: 'req_123',
        purpose: 'medication_review',
        read_reason: 'medication_stock_review',
        raw_text_included: true,
      },
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      authContextMock,
      expect.objectContaining({
        patientId: 'patient_1',
        targetType: 'inbound_communication_event',
        targetId: 'event_1',
        view: 'inbound_communication_detail',
        purpose: 'medication_review',
        metadata: expect.objectContaining({
          request_id: 'req_123',
          read_reason_code: 'medication_stock_review',
          attachment_count: 1,
        }),
      }),
    );
    const auditPayload = JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls[0]?.[1]);
    expect(auditPayload).not.toContain('湿布');
    expect(auditPayload).not.toContain('090-0000-0000');
  });

  it('rejects missing purpose before reading or auditing detail', async () => {
    const response = await GET(
      createRequest('?read_reason=medication_stock_review'),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('rejects invalid read_reason codes before reading or auditing detail', async () => {
    const response = await GET(
      createRequest('?purpose=care&read_reason=free-text-with-phi'),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a unified 404 without writing an audit when the event is out of scope', async () => {
    findFirstMock.mockResolvedValue(null);

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('keeps auth rejections no-store and does not access detail data', async () => {
    authRejectionMock.mockReturnValue(
      NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    );

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
