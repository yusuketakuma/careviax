import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  inboundCommunicationEventCreateMock,
  withOrgContextMock,
  canAccessMock,
  withAuthContextOptions,
} = vi.hoisted(() => ({
  inboundCommunicationEventCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  canAccessMock: vi.fn(),
  withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
    options?: { permission?: string; message?: string },
  ) => {
    withAuthContextOptions.push(options ?? {});
    return (req: NextRequest) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      });
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/communication-request-access', () => ({
  canAccessCommunicationRequestRecord: canAccessMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/communications/inbound/mcs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/communications/inbound/mcs', () => {
  it('is gated by the report capability', () => {
    expect(withAuthContextOptions).toContainEqual(
      expect.objectContaining({
        permission: 'canReport',
        message: 'MCS受信の登録権限がありません',
      }),
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    canAccessMock.mockResolvedValue(true);
    inboundCommunicationEventCreateMock.mockResolvedValue({
      id: 'event_mcs_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      event_type: 'medication_stock_report',
      source_channel: 'mcs',
      received_at: new Date('2026-07-07T01:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        inboundCommunicationEvent: {
          create: inboundCommunicationEventCreateMock,
        },
      }),
    );
  });

  it('creates an inbound MCS paste event and returns only a minimal review DTO', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        event_type: 'medication_stock_report',
        sender_name: '訪問看護師A',
        sender_role: '訪問看護師',
        sender_organization: '訪看ステーション',
        source_url: 'https://www.medical-care.net/projects/medical/57886227',
        content: 'カロナールは残り6錠です。storage_key=secret token=secret',
        posted_at: '2026-07-07T01:00:00.000Z',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(canAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        patientId: 'patient_1',
        caseId: 'case_1',
      }),
    );
    expect(inboundCommunicationEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        event_type: 'medication_stock_report',
        source_channel: 'mcs',
        source_system: 'mcs',
        external_url: 'https://www.medical-care.net/projects/medical/57886227',
        direction: 'inbound',
        sender_name: '訪問看護師A',
        sender_role: 'nurse',
        sender_organization_name: '訪看ステーション',
        normalized_summary: 'MCS貼り付け: 残数報告',
        raw_text: 'カロナールは残り6錠です。storage_key=secret token=secret',
        has_medication_stock_signal: true,
        has_patient_safety_signal: false,
        has_schedule_signal: false,
        confidence: 'high',
        processing_status: 'unprocessed',
        created_by: 'user_1',
        occurred_at: new Date('2026-07-07T01:00:00.000Z'),
      }),
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        event_type: true,
        source_channel: true,
        received_at: true,
      },
    });
    expect(payload).toMatchObject({
      data: {
        id: 'event_mcs_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        event_type: 'medication_stock_report',
        channel: 'mcs',
        status: 'needs_review',
        action_href: '/patients/patient_1/mcs',
      },
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('カロナール');
    expect(serialized).not.toContain('訪問看護師A');
    expect(serialized).not.toContain('訪看ステーション');
    expect(serialized).not.toContain('medical-care.net');
    expect(serialized).not.toContain('storage_key');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('subject');
    expect(serialized).not.toContain('content');
  });

  it('rejects non-MCS source URLs before creating the event', async () => {
    const response = await POST(
      createRequest({
        event_type: 'general_note',
        source_url: 'https://example.com/projects/1',
        content: 'MCS投稿です。',
      }),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(inboundCommunicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank content before creating the event', async () => {
    const response = await POST(
      createRequest({
        event_type: 'schedule_request',
        content: '   ',
      }),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(inboundCommunicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects inaccessible patient or case linkage', async () => {
    canAccessMock.mockResolvedValueOnce(false);

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        event_type: 'general_note',
        content: '確認事項です。',
      }),
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(inboundCommunicationEventCreateMock).not.toHaveBeenCalled();
  });
});
