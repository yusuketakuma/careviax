import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  careReportFindFirstMock,
  sendCareReportEmailMock,
  upsertBillingEvidenceForVisitMock,
  resolveOperationalTasksMock,
  learnContactProfileFromCommunicationMock,
  communicationEventCreateMock,
  txMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  sendCareReportEmailMock: vi.fn(),
  upsertBillingEvidenceForVisitMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  learnContactProfileFromCommunicationMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  txMock: {
    deliveryRecord: {
      create: vi.fn(),
    },
    careReport: {
      update: vi.fn(),
      findMany: vi.fn(),
    },
    conferenceNote: {
      findFirst: vi.fn(),
    },
    visitRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    medicationCycle: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    cycleTransitionLog: {
      create: vi.fn(),
    },
    communicationEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careReport: {
      findFirst: careReportFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/report-delivery', () => ({
  sendCareReportEmail: sendCareReportEmailMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  upsertBillingEvidenceForVisit: upsertBillingEvidenceForVisitMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

vi.mock('@/lib/contact-profiles', () => ({
  learnContactProfileFromCommunication: learnContactProfileFromCommunicationMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/care-reports/[id]/send POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'draft',
      visit_record_id: null,
      content: {},
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
    });
    sendCareReportEmailMock.mockResolvedValue({
      messageId: 'ses-message-1',
      stub: false,
    });
    txMock.deliveryRecord.create.mockResolvedValue({
      id: 'delivery_1',
      status: 'sent',
    });
    txMock.careReport.update.mockResolvedValue({
      id: 'report_1',
      status: 'sent',
    });
    txMock.conferenceNote.findFirst.mockResolvedValue(null);
    txMock.visitRecord.findFirst.mockResolvedValue(null);
    txMock.visitRecord.findMany.mockResolvedValue([]);
    txMock.careReport.findMany.mockResolvedValue([]);
    txMock.medicationCycle.findFirst.mockResolvedValue(null);
    txMock.medicationCycle.updateMany.mockResolvedValue({ count: 0 });
    txMock.cycleTransitionLog.create.mockResolvedValue({ id: 'transition_1' });
    txMock.communicationEvent.create = communicationEventCreateMock;
    communicationEventCreateMock.mockResolvedValue({ id: 'event_1' });
    upsertBillingEvidenceForVisitMock.mockResolvedValue(undefined);
    resolveOperationalTasksMock.mockResolvedValue(undefined);
    learnContactProfileFromCommunicationMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
  });

  it('returns 400 when email channel is used with a non-email contact', async () => {
    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: '03-1234-5678',
      }),
      { params: Promise.resolve({ id: 'report_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('sends report email through SES-backed delivery and records the delivery', async () => {
    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
      }),
      { params: Promise.resolve({ id: 'report_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(sendCareReportEmailMock).toHaveBeenCalledWith({
      to: 'doctor@example.com',
      recipientName: '山田 太郎',
      reportType: 'physician_report',
      reportId: 'report_1',
      pdfUrl: 'https://example.com/report.pdf',
    });
    expect(txMock.deliveryRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'email',
          status: 'sent',
        }),
      })
    );
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'physician_report',
          channel: 'email',
          counterpart_name: '山田 太郎',
        }),
      })
    );
    expect(learnContactProfileFromCommunicationMock).toHaveBeenCalledWith(txMock, {
      orgId: 'org_1',
      counterpartName: '山田 太郎',
      counterpartContact: 'doctor@example.com',
      channel: 'email',
      occurredAt: expect.any(Date),
      markSuccess: true,
    });
  });

  it('advances the medication cycle to reported through transition logging when all visit reports are delivered', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'draft',
      visit_record_id: 'visit_record_1',
      content: {},
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
    });
    txMock.visitRecord.findFirst.mockResolvedValue({
      schedule: {
        cycle_id: 'cycle_1',
      },
    });
    txMock.careReport.findMany.mockResolvedValue([{ status: 'sent' }]);
    txMock.medicationCycle.findFirst
      .mockResolvedValueOnce({ id: 'cycle_1', overall_status: 'visit_completed' })
      .mockResolvedValueOnce({
        id: 'cycle_1',
        overall_status: 'visit_completed',
        version: 1,
        patient_id: 'patient_1',
      });
    txMock.medicationCycle.updateMany.mockResolvedValue({ count: 1 });

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
      }),
      { params: Promise.resolve({ id: 'report_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.medicationCycle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cycle_1', version: 1 }),
        data: expect.objectContaining({ overall_status: 'reported' }),
      }),
    );
    expect(txMock.cycleTransitionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cycle_id: 'cycle_1',
          from_status: 'visit_completed',
          to_status: 'reported',
          note: '報告書送付完了',
        }),
      }),
    );
  });

  it('marks the delivery as failed when SES send fails', async () => {
    sendCareReportEmailMock.mockRejectedValue(new Error('SES unavailable'));

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
      }),
      { params: Promise.resolve({ id: 'report_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(502);
    expect(txMock.deliveryRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'email',
          status: 'failed',
          failure_reason: 'SES unavailable',
        }),
      })
    );
    expect(txMock.careReport.update).toHaveBeenCalledWith({
      where: { id: 'report_1' },
      data: { status: 'failed' },
    });
    expect(learnContactProfileFromCommunicationMock).toHaveBeenCalledWith(txMock, {
      orgId: 'org_1',
      counterpartName: '山田 太郎',
      counterpartContact: 'doctor@example.com',
      channel: 'email',
      occurredAt: expect.any(Date),
      markSuccess: false,
    });
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'delivery_failure',
          channel: 'email',
          counterpart_name: '山田 太郎',
        }),
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_EMAIL_SEND_FAILED',
    });
  });

  it('records resend communication events when an already-sent report is sent again', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'failed',
      visit_record_id: null,
      content: {},
      report_type: 'care_manager_report',
      pdf_url: 'https://example.com/report.pdf',
    });

    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '担当ケアマネ',
        recipient_contact: '03-1234-5678',
      }),
      { params: Promise.resolve({ id: 'report_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'resend',
          channel: 'fax',
          subject: 'care_manager_report',
        }),
      })
    );
  });

  it('does not create a primary communication event for non-MVP report types on first send', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'draft',
      visit_record_id: null,
      content: {},
      report_type: 'facility_handoff',
      pdf_url: 'https://example.com/report.pdf',
    });

    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '施設連携先',
        recipient_contact: '03-0000-0000',
      }),
      { params: Promise.resolve({ id: 'report_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('refreshes billing evidence for same-month visits when sending a conference-generated report', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'draft',
      visit_record_id: null,
      content: {
        conference_note_id: 'note_conf_1',
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
    });
    txMock.conferenceNote.findFirst.mockResolvedValue({
      case_id: 'case_1',
      conference_date: new Date('2026-03-18T10:00:00.000Z'),
    });
    txMock.visitRecord.findMany.mockResolvedValue([
      { id: 'visit_1' },
      { id: 'visit_2' },
    ]);

    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '主治医',
        recipient_contact: '03-1234-5678',
      }),
      { params: Promise.resolve({ id: 'report_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.conferenceNote.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'note_conf_1',
        org_id: 'org_1',
      },
      select: {
        case_id: true,
        conference_date: true,
      },
    });
    expect(txMock.visitRecord.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        visit_date: {
          gte: new Date('2026-02-28T15:00:00.000Z'),
          lte: new Date('2026-03-31T14:59:59.999Z'),
        },
        schedule: {
          case_id: 'case_1',
        },
      },
      select: {
        id: true,
      },
    });
    expect(upsertBillingEvidenceForVisitMock).toHaveBeenCalledTimes(2);
    expect(upsertBillingEvidenceForVisitMock).toHaveBeenNthCalledWith(1, txMock, {
      orgId: 'org_1',
      visitRecordId: 'visit_1',
    });
    expect(upsertBillingEvidenceForVisitMock).toHaveBeenNthCalledWith(2, txMock, {
      orgId: 'org_1',
      visitRecordId: 'visit_2',
    });
  });
});
