import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  requireAuthContextMock,
  withOrgContextMock,
  careReportFindFirstMock,
  visitRecordFindFirstMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  prescriptionIntakeFindFirstMock,
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
  careCaseFindManyMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  sendCareReportEmailMock: vi.fn(),
  upsertBillingEvidenceForVisitMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  learnContactProfileFromCommunicationMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  txMock: {
    deliveryRecord: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    careReport: {
      findFirst: vi.fn(),
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
      findMany: careCaseFindManyMock,
    },
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
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

function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['org_id', 'delivery_intent_key'] },
  });
}

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
      status: 'confirmed',
      visit_record_id: null,
      content: {},
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
    });
    visitRecordFindFirstMock.mockResolvedValue({
      version: 1,
      updated_at: new Date('2026-03-10T03:00:00.000Z'),
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
    careCaseFindManyMock.mockResolvedValue([
      {
        care_team_links: [
          {
            role: 'physician',
            name: '山田 太郎',
            organization_name: '山田クリニック',
            phone: '03-1234-5678',
            email: 'doctor@example.com',
            fax: '03-1234-5678',
            address: '東京都千代田区1-2-3',
            external_professional: null,
          },
          {
            role: 'care_manager',
            name: '担当ケアマネ',
            organization_name: 'ケア事業所',
            phone: '03-1234-5678',
            email: null,
            fax: '03-1234-5678',
            address: null,
            external_professional: null,
          },
          {
            role: 'facility_staff',
            name: '施設連携先',
            organization_name: '施設',
            phone: '03-0000-0000',
            email: null,
            fax: '03-0000-0000',
            address: null,
            external_professional: null,
          },
        ],
      },
    ]);
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      prescriber_name: '山田 太郎',
      prescriber_institution_ref: {
        name: '山田クリニック',
        phone: '03-1234-5678',
        fax: '03-1234-5678',
        address: '東京都千代田区1-2-3',
      },
    });
    sendCareReportEmailMock.mockResolvedValue({
      messageId: 'ses-message-1',
      stub: false,
    });
    txMock.deliveryRecord.findFirst.mockResolvedValue(null);
    txMock.deliveryRecord.create.mockResolvedValue({
      id: 'delivery_1',
      status: 'draft',
    });
    txMock.deliveryRecord.update.mockResolvedValue({
      id: 'delivery_1',
      status: 'sent',
    });
    txMock.deliveryRecord.updateMany.mockResolvedValue({ count: 1 });
    txMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
    txMock.careReport.update.mockResolvedValue({
      id: 'report_1',
      status: 'sent',
    });
    txMock.careReport.findFirst.mockResolvedValue({ content: {} });
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

  it('rejects unconfirmed draft reports before creating delivery side effects', async () => {
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

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
  });

  it('rejects confirmed visit reports when the source visit record changed after generation', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: 'visit_record_1',
      content: {
        source_provenance: {
          visit_record_id: 'visit_record_1',
          visit_record_version: 3,
          visit_record_updated_at: '2026-03-10T03:00:00.000Z',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
    });
    visitRecordFindFirstMock.mockResolvedValue({
      version: 4,
      updated_at: new Date('2026-03-10T04:00:00.000Z'),
    });

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問記録が更新されています。報告書を再生成してから送付してください',
      details: {
        visit_record_id: 'visit_record_1',
        current_visit_record_version: 4,
        current_visit_record_updated_at: '2026-03-10T04:00:00.000Z',
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
  });

  it('rejects confirmed visit reports that are missing source provenance', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: 'visit_record_1',
      content: {
        source_provenance: { visit_record_id: 'visit_record_1' },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
    });

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'missing_source_provenance',
        visit_record_id: 'visit_record_1',
      },
    });
    expect(visitRecordFindFirstMock).not.toHaveBeenCalledWith({
      where: { id: 'visit_record_1', org_id: 'org_1' },
      select: { version: true, updated_at: true },
    });
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
  });

  it('returns 400 when email channel is used with a non-email contact', async () => {
    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: '03-1234-5678',
        recipient_role: 'physician',
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
        recipient_role: 'physician',
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
        recipient_role: 'physician',
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
        recipient_role: 'physician',
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

  it('returns 400 before side effects when recipient role is missing', async () => {
    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '山田 太郎',
        recipient_contact: '03-1234-5678',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects report-recipient role mismatches before delivery side effects', async () => {
    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '担当ケアマネ',
        recipient_contact: '03-1234-5678',
        recipient_role: 'care_manager',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書タイプと送付先区分が一致していません',
    });
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects same-role recipients that are not current care-team or prescriber sources', async () => {
    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '別の医師',
        recipient_contact: 'other-doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '送付先が現在の患者関係者または処方元候補と一致していません',
    });
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects bulk sends when any recipient role does not match the report type', async () => {
    const response = await POST(
      createRequest({
        recipients: [
          {
            channel: 'fax',
            recipient_name: '主治医',
            recipient_contact: '03-1111-2222',
            recipient_role: 'physician',
          },
          {
            channel: 'fax',
            recipient_name: '担当ケアマネ',
            recipient_contact: '03-3333-4444',
            recipient_role: 'care_manager',
          },
        ],
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('sends report email through SES-backed delivery and records the delivery', async () => {
    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
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
              role: 'physician',
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
    expect(txMock.careReport.update).toHaveBeenCalledWith({
      where: { id: 'report_1' },
      data: expect.objectContaining({
        status: 'sent',
        content: expect.objectContaining({
          report_delivery_targets: [
            expect.objectContaining({
              delivery_record_id: 'delivery_1',
              recipient_name: '山田 太郎',
              recipient_role: 'physician',
              channel: 'email',
              status: 'sent',
              delivered_at: expect.any(String),
            }),
          ],
        }),
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        deliveries: [
          {
            delivery_record_id: 'delivery_1',
            recipient_role: 'physician',
            status: 'sent',
          },
        ],
      },
    });
  });

  it('appends delivery target provenance without dropping existing report content metadata', async () => {
    const currentContent = {
      source_provenance: { visit_record_id: 'visit_record_1' },
      report_delivery_targets: [{ delivery_record_id: 'delivery_previous' }],
    };
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      content: currentContent,
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
    });
    txMock.careReport.findFirst.mockResolvedValue({ content: currentContent });

    const response = await POST(
      createRequest({
        channel: 'fax',
        recipient_name: '山田 太郎',
        recipient_contact: '03-1234-5678',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.careReport.update).toHaveBeenCalledWith({
      where: { id: 'report_1' },
      data: expect.objectContaining({
        status: 'sent',
        content: {
          source_provenance: { visit_record_id: 'visit_record_1' },
          report_delivery_targets: [
            { delivery_record_id: 'delivery_previous' },
            expect.objectContaining({
              delivery_record_id: 'delivery_1',
              recipient_role: 'physician',
              channel: 'fax',
              status: 'sent',
            }),
          ],
        },
      }),
    });
  });

  it('does not resend when the same recipient already has a sent delivery record', async () => {
    txMock.deliveryRecord.findFirst.mockResolvedValueOnce({
      id: 'delivery_existing',
      status: 'sent',
    });
    txMock.careReport.findFirst.mockResolvedValue({
      content: {
        report_delivery_targets: [
          {
            delivery_record_id: 'delivery_existing',
            recipient_role: 'physician',
            channel: 'email',
            status: 'sent',
          },
        ],
      },
    });

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.update).not.toHaveBeenCalled();
    expect(txMock.careReport.update).toHaveBeenCalledWith({
      where: { id: 'report_1' },
      data: expect.objectContaining({
        content: expect.objectContaining({
          report_delivery_targets: [
            expect.objectContaining({
              delivery_record_id: 'delivery_existing',
            }),
          ],
        }),
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        deliveries: [
          {
            delivery_record_id: 'delivery_existing',
            status: 'sent',
            reused_existing_delivery: true,
            external_send_skipped: true,
          },
        ],
        reused_delivery_count: 1,
        retry_finalized_from_existing_delivery: true,
      },
    });
  });

  it('returns conflict without sending when the same recipient already has an in-progress delivery', async () => {
    txMock.deliveryRecord.findFirst.mockResolvedValueOnce({
      id: 'delivery_in_progress',
      status: 'draft',
      updated_at: new Date(),
    });

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json).toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ送付先への報告書送付が進行中です。送付履歴を確認してください',
      details: {
        report_id: 'report_1',
        recipient_contact_masked: 'd***@example.com',
        channel: 'email',
      },
    });
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.updateMany).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.careReport.update).not.toHaveBeenCalled();
  });

  it('reclaims a stale draft delivery and retries the send attempt', async () => {
    const staleUpdatedAt = new Date('2026-06-11T00:00:00.000Z');
    txMock.deliveryRecord.findFirst.mockResolvedValueOnce({
      id: 'delivery_stale_draft',
      status: 'draft',
      updated_at: staleUpdatedAt,
    });

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery_stale_draft',
        org_id: 'org_1',
        status: 'draft',
        updated_at: staleUpdatedAt,
      },
      data: expect.objectContaining({
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
        failure_reason: null,
        retry_count: { increment: 1 },
      }),
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'care_report_delivery_attempted',
          target_type: 'care_report',
          target_id: 'report_1',
          changes: expect.objectContaining({
            delivery_record_id: 'delivery_stale_draft',
            channel: 'email',
            safety_ack: true,
            recipient: expect.objectContaining({
              contact_masked: 'd***@example.com',
            }),
          }),
        }),
      }),
    );
    expect(txMock.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(
      sendCareReportEmailMock.mock.invocationCallOrder[0],
    );
    expect(sendCareReportEmailMock).toHaveBeenCalled();
    expect(txMock.deliveryRecord.update).toHaveBeenCalledWith({
      where: { id: 'delivery_stale_draft' },
      data: expect.objectContaining({
        status: 'sent',
        failure_reason: null,
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        deliveries: [{ delivery_record_id: 'delivery_stale_draft', status: 'sent' }],
      },
    });
  });

  it('returns conflict if a stale draft delivery is claimed by another request first', async () => {
    const staleUpdatedAt = new Date('2026-06-11T00:00:00.000Z');
    txMock.deliveryRecord.findFirst.mockResolvedValueOnce({
      id: 'delivery_stale_draft',
      status: 'draft',
      updated_at: staleUpdatedAt,
    });
    txMock.deliveryRecord.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json).toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ送付先への報告書送付が進行中です。送付履歴を確認してください',
      details: {
        report_id: 'report_1',
        recipient_contact_masked: 'd***@example.com',
        channel: 'email',
      },
    });
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.update).not.toHaveBeenCalled();
    expect(txMock.careReport.update).not.toHaveBeenCalled();
  });

  it('returns conflict without sending when a concurrent delivery insert wins the idempotency key race', async () => {
    txMock.deliveryRecord.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'delivery_race', status: 'draft' });
    txMock.deliveryRecord.create.mockRejectedValueOnce(buildUniqueConstraintError());

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ送付先への報告書送付が進行中です。送付履歴を確認してください',
    });
    expect(txMock.deliveryRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
        }),
      }),
    );
    const deliveryIntentKey = txMock.deliveryRecord.create.mock.calls[0]?.[0]?.data
      .delivery_intent_key as string;
    expect(txMock.deliveryRecord.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { delivery_intent_key: deliveryIntentKey },
            { delivery_intent_key: null, recipient_contact: 'doctor@example.com' },
          ],
        }),
      }),
    );
    expect(txMock.deliveryRecord.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          delivery_intent_key: deliveryIntentKey,
        },
      }),
    );
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.careReport.update).not.toHaveBeenCalled();
  });

  it('retries a failed same-recipient delivery by reusing the existing delivery record', async () => {
    txMock.deliveryRecord.findFirst.mockResolvedValueOnce({
      id: 'delivery_failed_previous',
      status: 'failed',
    });
    txMock.deliveryRecord.update
      .mockResolvedValueOnce({
        id: 'delivery_failed_previous',
        status: 'draft',
      })
      .mockResolvedValueOnce({
        id: 'delivery_failed_previous',
        status: 'sent',
      });

    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'delivery_failed_previous' },
      data: expect.objectContaining({
        status: 'draft',
        failure_reason: null,
        retry_count: { increment: 1 },
        delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
      }),
    });
    expect(sendCareReportEmailMock).toHaveBeenCalled();
    expect(txMock.deliveryRecord.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'delivery_failed_previous' },
      data: expect.objectContaining({
        status: 'sent',
        failure_reason: null,
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        deliveries: [{ delivery_record_id: 'delivery_failed_previous', status: 'sent' }],
      },
    });
  });

  it('lets an org-wide pharmacist send a report for a case assigned to other pharmacists', async () => {
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
      status: 'confirmed',
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
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(sendCareReportEmailMock).toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).toHaveBeenCalled();
  });

  it('advances the medication cycle to reported through transition logging when all visit reports are delivered', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: 'visit_record_1',
      content: {
        source_provenance: {
          visit_record_id: 'visit_record_1',
          visit_record_version: 1,
          visit_record_updated_at: '2026-03-10T03:00:00.000Z',
        },
      },
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
        recipient_role: 'physician',
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
        recipient_role: 'physician',
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
          failure_reason: 'メール送信に失敗しました',
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
          content: 'メール送信に失敗しました',
        }),
      }),
    );
    const json = await response.json();
    expect(json).toMatchObject({
      code: 'EXTERNAL_EMAIL_SEND_FAILED',
      details: {
        provider: 'ses',
        failed_recipients: 1,
        deliveries: [
          {
            delivery_record_id: 'delivery_1',
            channel: 'email',
            recipient_contact_masked: 'd***@example.com',
            status: 'failed',
            failure_reason: 'メール送信に失敗しました',
            retryable: true,
          },
        ],
      },
    });
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
  });

  it('keeps the report awaiting response when a bulk send partially fails', async () => {
    txMock.deliveryRecord.create
      .mockResolvedValueOnce({ id: 'delivery_success', status: 'draft' })
      .mockResolvedValueOnce({ id: 'delivery_failed', status: 'draft' });
    txMock.careReport.update.mockResolvedValueOnce({
      id: 'report_1',
      status: 'response_waiting',
    });
    sendCareReportEmailMock.mockRejectedValueOnce(new Error('SES unavailable'));

    const response = await POST(
      createRequest({
        recipients: [
          {
            channel: 'fax',
            recipient_name: '山田 太郎',
            recipient_contact: '03-1234-5678',
            recipient_role: 'physician',
          },
          {
            channel: 'email',
            recipient_name: '山田 太郎',
            recipient_contact: 'doctor@example.com',
            recipient_role: 'physician',
          },
        ],
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.careReport.update).toHaveBeenCalledWith({
      where: { id: 'report_1' },
      data: expect.objectContaining({
        status: 'response_waiting',
        content: expect.objectContaining({
          report_delivery_targets: [
            expect.objectContaining({
              delivery_record_id: 'delivery_success',
              status: 'sent',
            }),
            expect.objectContaining({
              delivery_record_id: 'delivery_failed',
              status: 'failed',
              failure_reason: 'メール送信に失敗しました',
            }),
          ],
        }),
      }),
    });
    const json = await response.json();
    expect(json).toMatchObject({
      data: {
        report: { status: 'response_waiting' },
        sent_count: 1,
        failed_count: 1,
        deliveries: [
          { delivery_record_id: 'delivery_success', status: 'sent' },
          {
            delivery_record_id: 'delivery_failed',
            status: 'failed',
            failure_reason: 'メール送信に失敗しました',
            retryable: true,
            recipient_contact_masked: 'd***@example.com',
          },
        ],
      },
    });
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
    expect(JSON.stringify(json)).not.toContain('03-1234-5678');
  });

  it('records primary communication events for confirmed care-manager reports', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
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
        recipient_role: 'care_manager',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'care_manager_report',
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
      status: 'confirmed',
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
        recipient_role: 'facility_staff',
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
      status: 'confirmed',
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
        recipient_name: '山田 太郎',
        recipient_contact: '03-1234-5678',
        recipient_role: 'physician',
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
