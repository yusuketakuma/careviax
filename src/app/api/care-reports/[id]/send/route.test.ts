import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  careReportFindFirstMock,
  visitRecordFindFirstMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
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
  visitRecordFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  sendCareReportEmailMock: vi.fn(),
  upsertBillingEvidenceForVisitMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  learnContactProfileFromCommunicationMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  txMock: {
    deliveryRecord: {
      create: vi.fn(),
      update: vi.fn(),
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
    auditLog: {
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
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
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
  return new NextRequest('http://localhost/api/care-reports/report_1/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedRequest() {
  return new NextRequest('http://localhost/api/care-reports/report_1/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{"channel":',
  });
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
    visitRecordFindFirstMock.mockResolvedValue({
      schedule: {
        pharmacist_id: 'user_1',
        case_: {
          primary_pharmacist_id: null,
          backup_pharmacist_id: null,
        },
      },
    });
    visitScheduleFindFirstMock.mockResolvedValue({ id: 'schedule_1' });
    careCaseFindFirstMock.mockResolvedValue({
      primary_pharmacist_id: 'user_1',
      backup_pharmacist_id: null,
    });
    sendCareReportEmailMock.mockResolvedValue({
      messageId: 'ses-message-1',
      stub: false,
    });
    txMock.deliveryRecord.create.mockResolvedValue({
      id: 'delivery_1',
      status: 'draft',
    });
    txMock.deliveryRecord.update.mockResolvedValue({
      id: 'delivery_1',
      status: 'sent',
    });
    txMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
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
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(Object), {
      permission: 'canSendCareReport',
      message: '報告書送信の権限がありません',
    });
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects blank report ids before loading the report or delivery side effects', async () => {
    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '山田 太郎',
        recipient_contact: '03-1234-5678',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: '   ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書IDが不正です',
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('returns 400 when recipient fields contain only whitespace', async () => {
    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '   ',
        recipient_contact: '   ',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        recipient_name: ['送付先氏名は必須です'],
        recipient_contact: ['送付先連絡先は必須です'],
      },
    });
  });

  it('rejects non-object request bodies before loading the report or delivery side effects', async () => {
    const response = await POST(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the report or delivery side effects', async () => {
    const response = await POST(createMalformedRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the safety acknowledgement is missing', async () => {
    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '山田 太郎',
        recipient_contact: '03-1234-5678',
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
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
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
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
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          status: 'draft',
        }),
      }),
    );
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'care_report_delivery_attempted',
          target_type: 'care_report',
          target_id: 'report_1',
          changes: expect.objectContaining({
            channel: 'email',
            safety_ack: true,
            report_type: 'physician_report',
            recipient: {
              name: '山田 太郎',
              contact_masked: 'd***@example.com',
            },
          }),
        }),
      }),
    );
    expect(txMock.deliveryRecord.create.mock.invocationCallOrder[0]).toBeLessThan(
      sendCareReportEmailMock.mock.invocationCallOrder[0],
    );
    expect(txMock.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(
      sendCareReportEmailMock.mock.invocationCallOrder[0],
    );
    expect(txMock.deliveryRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery_1' },
        data: expect.objectContaining({
          status: 'sent',
          failure_reason: null,
          sent_at: expect.any(Date),
        }),
      }),
    );
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'physician_report',
          channel: 'email',
          counterpart_name: '山田 太郎',
        }),
      }),
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

  it('returns 403 before sending email when a non-admin caller cannot access the report assignment', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
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
    careCaseFindFirstMock.mockResolvedValue({
      primary_pharmacist_id: 'primary_user',
      backup_pharmacist_id: 'backup_user',
    });

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
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
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
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
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(502);
    expect(txMock.deliveryRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'email',
          status: 'draft',
        }),
      }),
    );
    expect(txMock.deliveryRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery_1' },
        data: expect.objectContaining({
          status: 'failed',
          failure_reason: 'SES unavailable',
        }),
      }),
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
      }),
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
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
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
      }),
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
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
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
    txMock.visitRecord.findMany.mockResolvedValue([{ id: 'visit_1' }, { id: 'visit_2' }]);

    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '主治医',
        recipient_contact: '03-1234-5678',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
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
