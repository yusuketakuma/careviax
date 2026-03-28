import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  tracingReportFindFirstMock,
  tracingReportUpdateMock,
  communicationRequestFindFirstMock,
  communicationRequestCreateMock,
  communicationRequestUpdateMock,
  communicationEventCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  tracingReportUpdateMock: vi.fn(),
  communicationRequestFindFirstMock: vi.fn(),
  communicationRequestCreateMock: vi.fn(),
  communicationRequestUpdateMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    tracingReport: {
      findFirst: tracingReportFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/tracing-reports/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'draft',
      sent_to_physician: null,
      sent_at: null,
      acknowledged_at: null,
    });
    tracingReportUpdateMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      issue_id: 'issue_1',
      content: {},
      status: 'sent',
      sent_to_physician: '在宅主治医',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
      pdf_url: '/api/tracing-reports/tracing_1/pdf',
      created_at: new Date('2026-03-28T04:00:00.000Z'),
      updated_at: new Date('2026-03-28T05:00:00.000Z'),
    });
    communicationRequestFindFirstMock.mockResolvedValue(null);
    communicationRequestCreateMock.mockResolvedValue({ id: 'request_1' });
    communicationRequestUpdateMock.mockResolvedValue({ id: 'request_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        tracingReport: {
          update: tracingReportUpdateMock,
        },
        communicationRequest: {
          findFirst: communicationRequestFindFirstMock,
          create: communicationRequestCreateMock,
          update: communicationRequestUpdateMock,
        },
        communicationEvent: {
          create: communicationEventCreateMock,
        },
      })
    );
  });

  it('marks a draft tracing report as sent and creates a linked communication request', async () => {
    const response = await PATCH(
      createRequest(
        { status: 'sent', sent_to_physician: '在宅主治医' },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(tracingReportUpdateMock).toHaveBeenCalledWith({
      where: { id: 'tracing_1' },
      data: expect.objectContaining({
        status: 'sent',
        sent_to_physician: '在宅主治医',
        pdf_url: '/api/tracing-reports/tracing_1/pdf',
      }),
      select: expect.any(Object),
    });
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        status: 'sent',
        recipient_name: '在宅主治医',
      }),
    });
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'tracing_report',
          counterpart_name: '在宅主治医',
          channel: 'fax',
        }),
      })
    );
  });

  it('closes the linked communication request when a tracing report is acknowledged', async () => {
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      sent_to_physician: '在宅主治医',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });
    tracingReportUpdateMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      issue_id: 'issue_1',
      content: {},
      status: 'acknowledged',
      sent_to_physician: '在宅主治医',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: new Date('2026-03-28T06:00:00.000Z'),
      pdf_url: '/api/tracing-reports/tracing_1/pdf',
      created_at: new Date('2026-03-28T04:00:00.000Z'),
      updated_at: new Date('2026-03-28T06:00:00.000Z'),
    });
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'received',
    });

    const response = await PATCH(
      createRequest({ status: 'acknowledged' }, { 'x-org-id': 'org_1' }),
      { params: Promise.resolve({ id: 'tracing_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateMock).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: {
        status: 'closed',
        recipient_name: '在宅主治医',
      },
    });
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
  });
});
