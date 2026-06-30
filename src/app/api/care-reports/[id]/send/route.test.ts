import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { EMAIL_DELIVERY_FAILURE_REASON } from '@/lib/reports/delivery-failure-reasons';

const {
  requireAuthContextMock,
  withOrgContextMock,
  careReportFindFirstMock,
  visitRecordFindFirstMock,
  partnerVisitRecordFindFirstMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  prescriptionIntakeFindFirstMock,
  sendCareReportEmailMock,
  upsertBillingEvidenceForVisitMock,
  resolveOperationalTasksMock,
  learnContactProfileFromCommunicationMock,
  communicationEventCreateMock,
  loggerWarnMock,
  loggerErrorMock,
  txMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  partnerVisitRecordFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  sendCareReportEmailMock: vi.fn(),
  upsertBillingEvidenceForVisitMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  learnContactProfileFromCommunicationMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  txMock: {
    deliveryRecord: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    careReportSendRequest: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    careReport: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    conferenceNote: {
      findFirst: vi.fn(),
    },
    visitRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    partnerVisitRecord: {
      findFirst: vi.fn(),
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
    partnerVisitRecord: {
      findFirst: partnerVisitRecordFindFirstMock,
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

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

import { POST } from './route';

const REPORT_UPDATED_AT = new Date('2026-05-12T00:00:00.000Z');
const REPORT_UPDATED_AT_ISO = REPORT_UPDATED_AT.toISOString();

function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['org_id', 'delivery_intent_key'] },
  });
}

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  const effectiveBody =
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('expected_updated_at' in body)
      ? { ...body, expected_updated_at: REPORT_UPDATED_AT_ISO }
      : body;
  return new NextRequest('http://localhost/api/care-reports/report_1/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
      ...headers,
    },
    body: JSON.stringify(effectiveBody),
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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function buildExpectedSendRequestFingerprint(
  recipients: unknown[],
  expectedUpdatedAtOrSecret: Date | string = REPORT_UPDATED_AT,
  secretMaybe?: string,
) {
  const expectedUpdatedAt =
    expectedUpdatedAtOrSecret instanceof Date ? expectedUpdatedAtOrSecret : REPORT_UPDATED_AT;
  const secret =
    typeof expectedUpdatedAtOrSecret === 'string'
      ? expectedUpdatedAtOrSecret
      : (secretMaybe ?? 'ph-os-local-auth-secret');
  return `care-report-send-request:v2:${createHmac('sha256', secret)
    .update(
      JSON.stringify({
        action: 'care_report.send',
        report_id: 'report_1',
        expected_updated_at: expectedUpdatedAt.toISOString(),
        recipients,
        safety_ack: true,
      }),
    )
    .digest('hex')}`;
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
      updated_at: REPORT_UPDATED_AT,
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
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      revision_no: 1,
      updated_at: new Date('2026-06-18T03:10:00.000Z'),
      status: 'confirmed',
      confirmed_at: new Date('2026-06-18T03:00:00.000Z'),
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
    txMock.careReportSendRequest.findFirst.mockResolvedValue(null);
    txMock.careReportSendRequest.create.mockResolvedValue({ id: 'send_request_1' });
    txMock.careReportSendRequest.update.mockResolvedValue({ id: 'send_request_1' });
    txMock.careReportSendRequest.updateMany.mockResolvedValue({ count: 1 });
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
    txMock.careReport.updateMany.mockResolvedValue({ count: 1 });
    txMock.careReport.findFirst.mockResolvedValue({
      content: {},
      status: 'confirmed',
      updated_at: REPORT_UPDATED_AT,
    });
    txMock.conferenceNote.findFirst.mockResolvedValue(null);
    txMock.visitRecord.findFirst.mockResolvedValue(null);
    txMock.visitRecord.findMany.mockResolvedValue([]);
    txMock.partnerVisitRecord.findFirst.mockResolvedValue({
      revision_no: 1,
      updated_at: new Date('2026-06-18T03:10:00.000Z'),
      status: 'confirmed',
      confirmed_at: new Date('2026-06-18T03:00:00.000Z'),
    });
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
      updated_at: REPORT_UPDATED_AT,
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
    expectSensitiveNoStore(response);
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
  });

  it('rejects stale report versions before delivery side effects', async () => {
    const response = await POST(
      createRequest({
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        expected_updated_at: '2026-05-11T23:59:59.000Z',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '報告書が同時に更新されました。再読み込みしてください',
    });
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.careReportSendRequest.create).not.toHaveBeenCalled();
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
      updated_at: REPORT_UPDATED_AT,
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
      updated_at: REPORT_UPDATED_AT,
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

  it('rejects confirmed partner-visit reports when the source partner visit record changed after draft generation', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_visit_record_revision_no: 1,
          partner_visit_record_updated_at: '2026-06-18T03:10:00.000Z',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      revision_no: 2,
      updated_at: new Date('2026-06-18T04:00:00.000Z'),
      status: 'confirmed',
      confirmed_at: new Date('2026-06-18T03:00:00.000Z'),
    });

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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '協力訪問記録が更新されています。報告書を再生成してから送付してください',
      details: {
        reason: 'source_partner_visit_record_stale',
        partner_visit_record_id: 'partner_visit_record_1',
        current_partner_visit_record_revision_no: 2,
        current_partner_visit_record_updated_at: '2026-06-18T04:00:00.000Z',
        current_partner_visit_record_status: 'confirmed',
      },
    });
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
  });

  it('rejects confirmed partner-visit reports that are missing partner source provenance', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });

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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'missing_partner_source_provenance',
        partner_visit_record_id: 'partner_visit_record_1',
      },
    });
    expect(partnerVisitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
  });

  it('rejects partner-visit reports with revision-only provenance because partner revisions are not monotonic', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_visit_record_revision_no: 1,
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });

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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'missing_partner_source_provenance',
        partner_visit_record_id: 'partner_visit_record_1',
      },
    });
    expect(partnerVisitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
  });

  it('rejects partner-visit reports when the source partner visit record is no longer confirmed', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_visit_record_revision_no: 1,
          partner_visit_record_updated_at: '2026-06-18T03:10:00.000Z',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      revision_no: 1,
      updated_at: new Date('2026-06-18T03:10:00.000Z'),
      status: 'returned',
      confirmed_at: null,
    });

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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'source_partner_visit_record_not_confirmed',
        partner_visit_record_id: 'partner_visit_record_1',
        current_partner_visit_record_status: 'returned',
      },
    });
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
  });

  it('rechecks partner visit source inside the delivery transaction before delivery side effects', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_visit_record_revision_no: 1,
          partner_visit_record_updated_at: '2026-06-18T03:10:00.000Z',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });
    partnerVisitRecordFindFirstMock.mockResolvedValue({
      revision_no: 1,
      updated_at: new Date('2026-06-18T03:10:00.000Z'),
      status: 'confirmed',
      confirmed_at: new Date('2026-06-18T03:00:00.000Z'),
    });
    txMock.partnerVisitRecord.findFirst.mockResolvedValueOnce({
      revision_no: 1,
      updated_at: new Date('2026-06-18T03:10:00.000Z'),
      status: 'returned',
      confirmed_at: null,
    });

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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'source_partner_visit_record_not_confirmed',
        partner_visit_record_id: 'partner_visit_record_1',
        current_partner_visit_record_status: 'returned',
      },
    });
    expect(txMock.deliveryRecord.findFirst).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
  });

  it('rechecks partner visit source before marking record-only deliveries as sent', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_visit_record_revision_no: 1,
          partner_visit_record_updated_at: '2026-06-18T03:10:00.000Z',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });
    txMock.partnerVisitRecord.findFirst
      .mockResolvedValueOnce({
        revision_no: 1,
        updated_at: new Date('2026-06-18T03:10:00.000Z'),
        status: 'confirmed',
        confirmed_at: new Date('2026-06-18T03:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        revision_no: 1,
        updated_at: new Date('2026-06-18T03:10:00.000Z'),
        status: 'returned',
        confirmed_at: null,
      });
    const deliveryBlockTransactionIndexes: number[] = [];
    withOrgContextMock.mockImplementation(async (_orgId, callback) => {
      const transactionIndex = withOrgContextMock.mock.calls.length;
      const updateManyCallsBefore = txMock.deliveryRecord.updateMany.mock.calls.length;
      try {
        return await callback(txMock);
      } finally {
        if (txMock.deliveryRecord.updateMany.mock.calls.length > updateManyCallsBefore) {
          deliveryBlockTransactionIndexes.push(transactionIndex);
        }
      }
    });

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
    expect(response.status).toBe(409);
    expect(txMock.deliveryRecord.create).toHaveBeenCalled();
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
        org_id: 'org_1',
        status: 'draft',
      },
      data: {
        status: 'failed',
        failure_reason: 'source_partner_visit_record_not_confirmed',
      },
    });
    expect(txMock.deliveryRecord.update).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(deliveryBlockTransactionIndexes).toEqual([3]);
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'care_report_delivery_blocked_by_stale_partner_visit_record',
          changes: expect.objectContaining({
            delivery_record_id: 'delivery_1',
            channel: 'fax',
            failure_reason: 'source_partner_visit_record_not_confirmed',
          }),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'source_partner_visit_record_not_confirmed',
        partner_visit_record_id: 'partner_visit_record_1',
      },
    });
  });

  it('does not write blocked audit when record-only stale cleanup loses the draft race', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_visit_record_revision_no: 1,
          partner_visit_record_updated_at: '2026-06-18T03:10:00.000Z',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });
    txMock.partnerVisitRecord.findFirst
      .mockResolvedValueOnce({
        revision_no: 1,
        updated_at: new Date('2026-06-18T03:10:00.000Z'),
        status: 'confirmed',
        confirmed_at: new Date('2026-06-18T03:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        revision_no: 1,
        updated_at: new Date('2026-06-18T03:10:00.000Z'),
        status: 'returned',
        confirmed_at: null,
      });
    txMock.deliveryRecord.updateMany.mockResolvedValueOnce({ count: 0 });

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
    expect(response.status).toBe(409);
    expect(txMock.deliveryRecord.create).toHaveBeenCalled();
    expect(txMock.deliveryRecord.update).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'care_report_delivery_blocked_by_stale_partner_visit_record',
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ送付先への報告書送付が進行中です。送付履歴を確認してください',
      details: {
        channel: 'fax',
      },
    });
  });

  it('marks email delivery drafts failed when partner visit source becomes stale before external send', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_visit_record_revision_no: 1,
          partner_visit_record_updated_at: '2026-06-18T03:10:00.000Z',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });
    partnerVisitRecordFindFirstMock
      .mockResolvedValueOnce({
        revision_no: 1,
        updated_at: new Date('2026-06-18T03:10:00.000Z'),
        status: 'confirmed',
        confirmed_at: new Date('2026-06-18T03:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        revision_no: 1,
        updated_at: new Date('2026-06-18T03:10:00.000Z'),
        status: 'returned',
        confirmed_at: null,
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
    expect(txMock.deliveryRecord.create).toHaveBeenCalled();
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery_1',
        org_id: 'org_1',
        status: 'draft',
      },
      data: {
        status: 'failed',
        failure_reason: 'source_partner_visit_record_not_confirmed',
      },
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'care_report_delivery_blocked_by_stale_partner_visit_record',
          changes: expect.objectContaining({
            delivery_record_id: 'delivery_1',
            channel: 'email',
            failure_reason: 'source_partner_visit_record_not_confirmed',
          }),
        }),
      }),
    );
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        reason: 'source_partner_visit_record_not_confirmed',
        partner_visit_record_id: 'partner_visit_record_1',
      },
    });
  });

  it('does not write blocked audit or send email when email stale cleanup loses the draft race', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_visit_record_revision_no: 1,
          partner_visit_record_updated_at: '2026-06-18T03:10:00.000Z',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });
    partnerVisitRecordFindFirstMock
      .mockResolvedValueOnce({
        revision_no: 1,
        updated_at: new Date('2026-06-18T03:10:00.000Z'),
        status: 'confirmed',
        confirmed_at: new Date('2026-06-18T03:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        revision_no: 1,
        updated_at: new Date('2026-06-18T03:10:00.000Z'),
        status: 'returned',
        confirmed_at: null,
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
    expect(txMock.deliveryRecord.create).toHaveBeenCalled();
    expect(txMock.deliveryRecord.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'care_report_delivery_blocked_by_stale_partner_visit_record',
        }),
      }),
    );
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ送付先への報告書送付が進行中です。送付履歴を確認してください',
      details: {
        channel: 'email',
      },
    });
  });

  it('sends a partner-visit report when source provenance matches the current confirmed source', async () => {
    careReportFindFirstMock.mockResolvedValue({
      id: 'report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'confirmed',
      visit_record_id: null,
      partner_visit_record_id: 'partner_visit_record_1',
      content: {
        source_provenance: {
          source: 'partner_visit_record',
          partner_visit_record_id: 'partner_visit_record_1',
          partner_visit_record_revision_no: 1,
          partner_visit_record_updated_at: '2026-06-18T03:10:00.000Z',
        },
      },
      report_type: 'physician_report',
      pdf_url: 'https://example.com/report.pdf',
      updated_at: REPORT_UPDATED_AT,
    });

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
    expect(partnerVisitRecordFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'partner_visit_record_1', org_id: 'org_1' },
      select: {
        revision_no: true,
        updated_at: true,
        status: true,
        confirmed_at: true,
      },
    });
    expect(txMock.partnerVisitRecord.findFirst).toHaveBeenCalledWith({
      where: { id: 'partner_visit_record_1', org_id: 'org_1' },
      select: {
        revision_no: true,
        updated_at: true,
        status: true,
        confirmed_at: true,
      },
    });
    expect(txMock.deliveryRecord.create).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        report: { id: 'report_1', status: 'sent' },
        deliveries: [{ delivery_record_id: 'delivery_1', status: 'sent' }],
      },
    });
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

  it('rejects unsupported communication channels before delivery side effects', async () => {
    const response = await POST(
      createRequest({
        channel: 'sms',
        recipient_name: '山田 太郎',
        recipient_contact: '090-1234-5678',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { channel: expect.any(Array) },
    });
  });

  it('rejects PH-OS share direct sends before grantless delivery side effects', async () => {
    const response = await POST(
      createRequest({
        channel: 'ph_os_share',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { channel: expect.any(Array) },
    });
  });

  it('rejects PH-OS share bulk direct sends before report load or delivery side effects', async () => {
    const response = await POST(
      createRequest({
        recipients: [
          {
            channel: 'ph_os_share',
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
    expect(response.status).toBe(400);
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { recipients: expect.any(Array) },
    });
  });

  it('rejects malformed Idempotency-Key before loading the report', async () => {
    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'bad key with spaces' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Idempotency-Keyが不正です',
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
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
    expectSensitiveNoStore(response);
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
    expectSensitiveNoStore(response);
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
    expectSensitiveNoStore(response);
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

  it('returns a sanitized no-store 500 when report lookup fails unexpectedly', async () => {
    careReportFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田花子 report send lookup token=secret raw failure'),
    );

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
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('token=secret');
    expect(JSON.stringify(body)).not.toContain('raw failure');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
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
    expectSensitiveNoStore(response);
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
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'delivery_1',
          org_id: 'org_1',
          report_id: 'report_1',
          status: 'draft',
          delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
        },
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
    expect(txMock.careReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'report_1',
          org_id: 'org_1',
          status: 'confirmed',
          updated_at: REPORT_UPDATED_AT,
        },
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
      }),
    );
    const json = await response.json();
    expect(json).toMatchObject({
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
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
    expect(JSON.stringify(json)).not.toContain('山田 太郎');
  });

  it('returns conflict when report finalization loses the version claim after delivery', async () => {
    txMock.careReport.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-final-race' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(sendCareReportEmailMock).toHaveBeenCalledOnce();
    expect(txMock.careReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'report_1',
          org_id: 'org_1',
          status: 'confirmed',
          updated_at: REPORT_UPDATED_AT,
        },
        data: expect.objectContaining({ status: 'sent' }),
      }),
    );
    expect(txMock.careReportSendRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'send_request_1',
          org_id: 'org_1',
          report_id: 'report_1',
          status: 'in_progress',
        }),
        data: expect.objectContaining({
          status: 'completed',
          response_status: 409,
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        report_id: 'report_1',
        reason: 'report_finalization_stale',
      },
    });
  });

  it('returns conflict when delivery sent finalization loses the draft claim', async () => {
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
    expectSensitiveNoStore(response);
    expect(sendCareReportEmailMock).toHaveBeenCalledOnce();
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'delivery_1',
          org_id: 'org_1',
          report_id: 'report_1',
          status: 'draft',
          delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
        },
        data: expect.objectContaining({ status: 'sent' }),
      }),
    );
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
    expect(txMock.careReport.updateMany).not.toHaveBeenCalled();
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
  });

  it('stores keyed delivery sent-claim conflicts without raw contact details', async () => {
    txMock.deliveryRecord.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-delivery-sent-race' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(txMock.careReportSendRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'send_request_1',
          org_id: 'org_1',
          report_id: 'report_1',
          status: 'in_progress',
        }),
        data: expect.objectContaining({
          status: 'completed',
          response_status: 409,
          response_body: expect.objectContaining({
            code: 'WORKFLOW_CONFLICT',
            details: expect.objectContaining({
              recipient_contact_masked: 'd***@example.com',
            }),
          }),
        }),
      }),
    );
    const json = await response.json();
    expect(json).toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        report_id: 'report_1',
        recipient_contact_masked: 'd***@example.com',
        channel: 'email',
      },
    });
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
    expect(JSON.stringify(txMock.careReportSendRequest.updateMany.mock.calls.at(-1))).not.toContain(
      'doctor@example.com',
    );
  });

  it('stores a completed response for a keyed report send request', async () => {
    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-1' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.careReportSendRequest.create).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        report_id: 'report_1',
        idempotency_key_hash: expect.stringMatching(/^care-report-send:v2:[a-f0-9]{64}$/),
        request_fingerprint: expect.stringMatching(/^care-report-send-request:v2:[a-f0-9]{64}$/),
        claim_token: expect.stringMatching(/^[0-9a-f-]{36}$/),
        created_by: 'user_1',
      },
      select: { id: true },
    });
    expect(sendCareReportEmailMock).toHaveBeenCalledOnce();
    expect(txMock.careReportSendRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'send_request_1',
        org_id: 'org_1',
        report_id: 'report_1',
        status: 'in_progress',
        claim_token: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
      data: expect.objectContaining({
        status: 'completed',
        response_status: 200,
        completed_at: expect.any(Date),
        response_body: expect.objectContaining({
          data: expect.objectContaining({
            deliveries: [
              expect.objectContaining({
                delivery_record_id: 'delivery_1',
                status: 'sent',
              }),
            ],
          }),
        }),
      }),
    });
    const storedResponse =
      txMock.careReportSendRequest.updateMany.mock.calls.at(-1)?.[0]?.data.response_body;
    expect(JSON.stringify(storedResponse)).not.toContain('doctor@example.com');
    expect(JSON.stringify(storedResponse)).not.toContain('山田 太郎');
    expect(JSON.stringify(storedResponse)).not.toContain('patient_1');
    expect(JSON.stringify(storedResponse)).not.toContain('source_provenance');
    expect(JSON.stringify(storedResponse)).not.toContain('report.pdf');
    const json = await response.json();
    expect(json).toEqual(storedResponse);
    expect(json).toMatchObject({
      data: {
        report: { id: 'report_1', status: 'sent' },
        deliveries: [
          {
            delivery_record_id: 'delivery_1',
            status: 'sent',
            recipient_contact_masked: 'd***@example.com',
          },
        ],
      },
    });
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
    expect(JSON.stringify(json)).not.toContain('山田 太郎');

    sendCareReportEmailMock.mockClear();
    txMock.deliveryRecord.findFirst.mockClear();
    txMock.deliveryRecord.create.mockClear();
    txMock.careReport.updateMany.mockClear();
    txMock.careReportSendRequest.updateMany.mockClear();
    txMock.careReportSendRequest.findFirst.mockResolvedValueOnce({
      id: 'send_request_1',
      request_fingerprint: buildExpectedSendRequestFingerprint([
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
        },
      ]),
      status: 'completed',
      response_status: 200,
      response_body: storedResponse,
      updated_at: new Date('2026-06-18T00:00:00Z'),
    });

    const replayedResponse = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-1' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!replayedResponse) throw new Error('replayedResponse is required');
    expect(replayedResponse.status).toBe(200);
    await expect(replayedResponse.json()).resolves.toEqual(json);
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.findFirst).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.careReport.updateMany).not.toHaveBeenCalled();
    expect(txMock.careReportSendRequest.updateMany).not.toHaveBeenCalled();
  });

  it('reclaims a stale keyed send request with a new claim token before completion', async () => {
    const staleUpdatedAt = new Date(Date.now() - 11 * 60 * 1000);
    const requestFingerprint = buildExpectedSendRequestFingerprint([
      {
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
      },
    ]);
    const staleRecord = {
      id: 'send_request_1',
      request_fingerprint: requestFingerprint,
      status: 'in_progress',
      response_status: null,
      response_body: null,
      updated_at: staleUpdatedAt,
    };
    txMock.careReportSendRequest.findFirst
      .mockResolvedValueOnce(staleRecord)
      .mockResolvedValueOnce(staleRecord);

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-stale' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(txMock.careReportSendRequest.updateMany).toHaveBeenCalledTimes(2);
    const reclaimCall = txMock.careReportSendRequest.updateMany.mock.calls[0]?.[0];
    const completeCall = txMock.careReportSendRequest.updateMany.mock.calls[1]?.[0];
    const newClaimToken = reclaimCall?.data.claim_token;
    expect(reclaimCall).toMatchObject({
      where: {
        id: 'send_request_1',
        org_id: 'org_1',
        report_id: 'report_1',
        status: 'in_progress',
        request_fingerprint: requestFingerprint,
        updated_at: staleUpdatedAt,
      },
      data: {
        status: 'in_progress',
        response_status: null,
        completed_at: null,
        created_by: 'user_1',
      },
    });
    expect(newClaimToken).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(completeCall?.where).toMatchObject({
      id: 'send_request_1',
      org_id: 'org_1',
      report_id: 'report_1',
      status: 'in_progress',
      claim_token: newClaimToken,
    });
    expect(completeCall?.where.claim_token).not.toBe('old-claim-token');
  });

  it('falls back to the auth secret when the dedicated idempotency hash secret is blank', async () => {
    const originalDedicatedSecret = process.env.CARE_REPORT_IDEMPOTENCY_HASH_SECRET;
    const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
    const originalAuthSecret = process.env.AUTH_SECRET;
    process.env.CARE_REPORT_IDEMPOTENCY_HASH_SECRET = '   ';
    process.env.NEXTAUTH_SECRET = 'auth-secret-for-idempotency-test';
    delete process.env.AUTH_SECRET;
    try {
      const response = await POST(
        createRequest(
          {
            channel: 'email',
            recipient_name: '山田 太郎',
            recipient_contact: 'doctor@example.com',
            recipient_role: 'physician',
            safety_ack: true,
          },
          { 'idempotency-key': 'send-key-blank-secret' },
        ),
        { params: Promise.resolve({ id: 'report_1' }) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      const createCall = txMock.careReportSendRequest.create.mock.calls.at(-1)?.[0];
      expect(createCall?.data.request_fingerprint).toBe(
        buildExpectedSendRequestFingerprint(
          [
            {
              channel: 'email',
              recipient_name: '山田 太郎',
              recipient_contact: 'doctor@example.com',
              recipient_role: 'physician',
            },
          ],
          'auth-secret-for-idempotency-test',
        ),
      );
      expect(createCall?.data.request_fingerprint).not.toBe(
        buildExpectedSendRequestFingerprint(
          [
            {
              channel: 'email',
              recipient_name: '山田 太郎',
              recipient_contact: 'doctor@example.com',
              recipient_role: 'physician',
            },
          ],
          '',
        ),
      );
    } finally {
      if (originalDedicatedSecret === undefined) {
        delete process.env.CARE_REPORT_IDEMPOTENCY_HASH_SECRET;
      } else {
        process.env.CARE_REPORT_IDEMPOTENCY_HASH_SECRET = originalDedicatedSecret;
      }
      if (originalNextAuthSecret === undefined) {
        delete process.env.NEXTAUTH_SECRET;
      } else {
        process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
      }
      if (originalAuthSecret === undefined) {
        delete process.env.AUTH_SECRET;
      } else {
        process.env.AUTH_SECRET = originalAuthSecret;
      }
    }
  });

  it('returns the sent response when keyed idempotency completion cannot be persisted', async () => {
    txMock.careReportSendRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-1' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        report: { id: 'report_1', status: 'sent' },
        deliveries: [{ delivery_record_id: 'delivery_1', status: 'sent' }],
      },
    });
    expect(sendCareReportEmailMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'care_report.send_idempotency_completion_failed',
        orgId: 'org_1',
        userId: 'user_1',
        entityType: 'care_report',
        entityId: 'report_1',
        targetId: 'send_request_1',
        code: 'CARE_REPORT_SEND_IDEMPOTENCY_COMPLETION_FAILED',
        status: 200,
        count: 0,
      }),
    );
  });

  it('replays a completed keyed send response without external delivery side effects', async () => {
    const requestFingerprint = buildExpectedSendRequestFingerprint([
      {
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
      },
    ]);
    txMock.careReportSendRequest.findFirst.mockResolvedValueOnce({
      id: 'send_request_1',
      request_fingerprint: requestFingerprint,
      status: 'completed',
      response_status: 200,
      response_body: {
        data: {
          report: { id: 'report_1', status: 'sent' },
          deliveries: [{ delivery_record_id: 'delivery_1', status: 'sent' }],
          sent_count: 1,
          failed_count: 0,
          reused_delivery_count: 0,
          retry_finalized_from_existing_delivery: false,
        },
      },
      updated_at: new Date('2026-06-18T00:00:00Z'),
    });
    careCaseFindManyMock.mockResolvedValueOnce([{ care_team_links: [] }]);

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-1' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        deliveries: [{ delivery_record_id: 'delivery_1', status: 'sent' }],
        sent_count: 1,
      },
    });
    expect(txMock.deliveryRecord.findFirst).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.careReport.updateMany).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(txMock.careReportSendRequest.updateMany).not.toHaveBeenCalled();
  });

  it('returns idempotency conflict when the same key is reused with different recipients', async () => {
    txMock.careReportSendRequest.findFirst.mockResolvedValueOnce({
      id: 'send_request_1',
      request_fingerprint: 'care-report-send-request:v2:' + 'a'.repeat(64),
      status: 'completed',
      response_status: 200,
      response_body: { data: { ok: true } },
      updated_at: new Date('2026-06-18T00:00:00Z'),
    });

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-1' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Idempotency-Keyが別の報告書送付リクエストで使用されています',
      details: { reason: 'key_reused_with_different_request' },
    });
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
  });

  it('returns conflict without sending when the same keyed request is already in progress', async () => {
    const requestFingerprint = buildExpectedSendRequestFingerprint([
      {
        channel: 'email',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
      },
    ]);
    txMock.careReportSendRequest.findFirst.mockResolvedValueOnce({
      id: 'send_request_1',
      request_fingerprint: requestFingerprint,
      status: 'in_progress',
      response_status: null,
      response_body: null,
      updated_at: new Date(),
    });

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-1' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じIdempotency-Keyの報告書送付が進行中です',
      details: { reason: 'request_in_progress' },
    });
    expect(txMock.careReportSendRequest.updateMany).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
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
      updated_at: REPORT_UPDATED_AT,
    });
    txMock.careReport.findFirst.mockResolvedValue({
      content: currentContent,
      status: 'confirmed',
      updated_at: REPORT_UPDATED_AT,
    });

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
    expect(txMock.careReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'report_1',
          org_id: 'org_1',
          status: 'confirmed',
          updated_at: REPORT_UPDATED_AT,
        },
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
      }),
    );
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
      status: 'confirmed',
      updated_at: REPORT_UPDATED_AT,
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
    expect(txMock.careReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'report_1',
          org_id: 'org_1',
          status: 'confirmed',
          updated_at: REPORT_UPDATED_AT,
        },
        data: expect.objectContaining({
          content: expect.objectContaining({
            report_delivery_targets: [
              expect.objectContaining({
                delivery_record_id: 'delivery_existing',
              }),
            ],
          }),
        }),
      }),
    );
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
    expectSensitiveNoStore(response);
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
    expect(txMock.careReport.updateMany).not.toHaveBeenCalled();
  });

  it('stores a keyed delivery-conflict response without raw contact details', async () => {
    txMock.deliveryRecord.findFirst.mockResolvedValueOnce({
      id: 'delivery_in_progress',
      status: 'draft',
      updated_at: new Date(),
    });

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-conflict' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.careReportSendRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'send_request_1',
        org_id: 'org_1',
        report_id: 'report_1',
        status: 'in_progress',
        claim_token: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
      data: expect.objectContaining({
        status: 'completed',
        response_status: 409,
        response_body: expect.objectContaining({
          code: 'WORKFLOW_CONFLICT',
          details: expect.objectContaining({
            recipient_contact_masked: 'd***@example.com',
          }),
        }),
      }),
    });
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('doctor@example.com');
    expect(JSON.stringify(txMock.careReportSendRequest.updateMany.mock.calls.at(-1))).not.toContain(
      'doctor@example.com',
    );
  });

  it('returns the delivery-conflict response when keyed idempotency completion cannot be persisted', async () => {
    txMock.deliveryRecord.findFirst.mockResolvedValueOnce({
      id: 'delivery_in_progress',
      status: 'draft',
      updated_at: new Date(),
    });
    txMock.careReportSendRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-conflict' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { recipient_contact_masked: 'd***@example.com' },
    });
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'care_report.send_idempotency_completion_failed',
        code: 'CARE_REPORT_SEND_IDEMPOTENCY_COMPLETION_FAILED',
        entityId: 'report_1',
        targetId: 'send_request_1',
        status: 409,
        count: 0,
      }),
    );
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
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery_stale_draft',
        org_id: 'org_1',
        report_id: 'report_1',
        status: 'draft',
        delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
      },
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
    expect(txMock.careReport.updateMany).not.toHaveBeenCalled();
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
    expect(txMock.careReport.updateMany).not.toHaveBeenCalled();
  });

  it('retries a failed same-recipient delivery by reusing the existing delivery record', async () => {
    const failedUpdatedAt = new Date('2026-06-11T00:05:00.000Z');
    txMock.deliveryRecord.findFirst.mockResolvedValueOnce({
      id: 'delivery_failed_previous',
      status: 'failed',
      updated_at: failedUpdatedAt,
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
    expect(txMock.deliveryRecord.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'delivery_failed_previous',
        org_id: 'org_1',
        report_id: 'report_1',
        channel: 'email',
        status: 'failed',
        updated_at: failedUpdatedAt,
      },
      data: expect.objectContaining({
        status: 'draft',
        failure_reason: null,
        retry_count: { increment: 1 },
        delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
      }),
    });
    expect(sendCareReportEmailMock).toHaveBeenCalled();
    expect(txMock.deliveryRecord.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'delivery_failed_previous',
        org_id: 'org_1',
        report_id: 'report_1',
        status: 'draft',
        delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
      },
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

  it('returns conflict without sending when a failed retry claim loses the race', async () => {
    const failedUpdatedAt = new Date('2026-06-11T00:05:00.000Z');
    txMock.deliveryRecord.findFirst.mockResolvedValueOnce({
      id: 'delivery_failed_previous',
      status: 'failed',
      updated_at: failedUpdatedAt,
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
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery_failed_previous',
        org_id: 'org_1',
        report_id: 'report_1',
        channel: 'email',
        status: 'failed',
        updated_at: failedUpdatedAt,
      },
      data: expect.objectContaining({
        status: 'draft',
        failure_reason: null,
        retry_count: { increment: 1 },
        delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
      }),
    });
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.careReport.updateMany).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json).toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        report_id: 'report_1',
        recipient_contact_masked: 'd***@example.com',
        channel: 'email',
      },
    });
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
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
      updated_at: REPORT_UPDATED_AT,
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
      updated_at: REPORT_UPDATED_AT,
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

  it('does not complete visit reporting while a sibling report is still only confirmed', async () => {
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
      updated_at: REPORT_UPDATED_AT,
    });
    txMock.visitRecord.findFirst.mockResolvedValue({
      schedule: {
        cycle_id: 'cycle_1',
      },
    });
    txMock.careReport.findMany.mockResolvedValue([{ status: 'sent' }, { status: 'confirmed' }]);

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
    expect(txMock.medicationCycle.findFirst).not.toHaveBeenCalled();
    expect(txMock.medicationCycle.updateMany).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(upsertBillingEvidenceForVisitMock).not.toHaveBeenCalled();
  });

  it('marks the delivery as failed when SES send fails', async () => {
    const sesError = Object.assign(new Error('SES unavailable'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429 },
    });
    sendCareReportEmailMock.mockRejectedValue(sesError);

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
    expectSensitiveNoStore(response);
    expect(txMock.deliveryRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'email',
          status: 'draft',
        }),
      }),
    );
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'delivery_1',
          org_id: 'org_1',
          report_id: 'report_1',
          status: 'draft',
          delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
        },
        data: expect.objectContaining({
          status: 'failed',
          failure_reason: EMAIL_DELIVERY_FAILURE_REASON,
        }),
      }),
    );
    expect(txMock.careReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'report_1',
          org_id: 'org_1',
          status: 'confirmed',
          updated_at: REPORT_UPDATED_AT,
        },
        data: { status: 'failed' },
      }),
    );
    expect(loggerWarnMock).toHaveBeenCalledWith('care report email delivery failed', {
      event: 'care_report.email_delivery_failed',
      orgId: 'org_1',
      actorId: 'user_1',
      entityType: 'care_report',
      entityId: 'report_1',
      targetId: 'delivery_1',
      externalProvider: 'ses',
      error_name: 'ThrottlingException',
      status: 429,
      failure_class: 'transient',
    });
    const loggerPayloadText = JSON.stringify(loggerWarnMock.mock.calls);
    expect(loggerPayloadText).not.toContain('SES unavailable');
    expect(loggerPayloadText).not.toContain('doctor@example.com');
    expect(loggerPayloadText).not.toContain('message');
    expect(loggerPayloadText).not.toContain('stack');
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
          content: EMAIL_DELIVERY_FAILURE_REASON,
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
            failure_reason: EMAIL_DELIVERY_FAILURE_REASON,
            retryable: true,
          },
        ],
      },
    });
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
  });

  it('returns conflict when marking the report failed loses the version claim', async () => {
    const sesError = Object.assign(new Error('SES unavailable'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429 },
    });
    sendCareReportEmailMock.mockRejectedValue(sesError);
    txMock.careReport.updateMany.mockResolvedValueOnce({ count: 0 });

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
    expectSensitiveNoStore(response);
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'delivery_1',
          org_id: 'org_1',
          report_id: 'report_1',
          status: 'draft',
          delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
        },
        data: expect.objectContaining({
          status: 'failed',
          failure_reason: EMAIL_DELIVERY_FAILURE_REASON,
        }),
      }),
    );
    expect(txMock.careReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'report_1',
          org_id: 'org_1',
          status: 'confirmed',
          updated_at: REPORT_UPDATED_AT,
        },
        data: { status: 'failed' },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        report_id: 'report_1',
        reason: 'report_finalization_stale',
      },
    });
  });

  it('returns conflict when marking the delivery failed loses the draft claim', async () => {
    const sesError = Object.assign(new Error('SES unavailable'), {
      name: 'ThrottlingException',
      $metadata: { httpStatusCode: 429 },
    });
    sendCareReportEmailMock.mockRejectedValue(sesError);
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
    expectSensitiveNoStore(response);
    expect(txMock.deliveryRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'delivery_1',
          org_id: 'org_1',
          report_id: 'report_1',
          status: 'draft',
          delivery_intent_key: expect.stringMatching(/^care-report:v1:[a-f0-9]{64}$/),
        },
        data: expect.objectContaining({
          status: 'failed',
          failure_reason: EMAIL_DELIVERY_FAILURE_REASON,
        }),
      }),
    );
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
    expect(txMock.careReport.updateMany).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json).toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        report_id: 'report_1',
        recipient_contact_masked: 'd***@example.com',
        channel: 'email',
      },
    });
    expect(JSON.stringify(json)).not.toContain('doctor@example.com');
    expect(JSON.stringify(json)).not.toContain('SES unavailable');
  });

  it('logs permanent SES failures without exposing provider details to clients', async () => {
    const sesError = Object.assign(new Error('Address rejected'), {
      name: 'MessageRejected',
      $metadata: { httpStatusCode: 400 },
    });
    sendCareReportEmailMock.mockRejectedValue(sesError);

    const response = await POST(
      createRequest({
        channel: 'ses',
        recipient_name: '山田 太郎',
        recipient_contact: 'doctor@example.com',
        recipient_role: 'physician',
        safety_ack: true,
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(502);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'care report email delivery failed',
      expect.objectContaining({
        event: 'care_report.email_delivery_failed',
        externalProvider: 'ses',
        error_name: 'MessageRejected',
        status: 400,
        failure_class: 'permanent',
      }),
    );
    const loggerPayloadText = JSON.stringify(loggerWarnMock.mock.calls);
    expect(loggerPayloadText).not.toContain('Address rejected');
    expect(loggerPayloadText).not.toContain('doctor@example.com');
    const json = await response.json();
    expect(JSON.stringify(json)).toContain(EMAIL_DELIVERY_FAILURE_REASON);
    expect(JSON.stringify(json)).not.toContain('MessageRejected');
    expect(JSON.stringify(json)).not.toContain('Address rejected');
  });

  it('stores and replays keyed all-recipient send failure responses without re-sending', async () => {
    sendCareReportEmailMock.mockRejectedValueOnce(new Error('SES unavailable'));

    const failedResponse = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-failure' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!failedResponse) throw new Error('failedResponse is required');
    expect(failedResponse.status).toBe(502);
    const storedFailureBody =
      txMock.careReportSendRequest.updateMany.mock.calls.at(-1)?.[0]?.data.response_body;
    expect(storedFailureBody).toMatchObject({
      code: 'EXTERNAL_EMAIL_SEND_FAILED',
      details: {
        deliveries: [
          {
            delivery_record_id: 'delivery_1',
            status: 'failed',
            recipient_contact_masked: 'd***@example.com',
          },
        ],
      },
    });
    expect(JSON.stringify(storedFailureBody)).not.toContain('doctor@example.com');
    expect(JSON.stringify(storedFailureBody)).not.toContain('山田 太郎');

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
      updated_at: REPORT_UPDATED_AT,
    });
    txMock.careReportSendRequest.findFirst.mockResolvedValueOnce({
      id: 'send_request_1',
      request_fingerprint: buildExpectedSendRequestFingerprint([
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
        },
      ]),
      status: 'completed',
      response_status: 502,
      response_body: storedFailureBody,
      updated_at: new Date('2026-06-18T00:00:00Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));

    const replayedResponse = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-failure' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!replayedResponse) throw new Error('replayedResponse is required');
    expect(replayedResponse.status).toBe(502);
    await expect(replayedResponse.json()).resolves.toMatchObject(storedFailureBody);
    expect(sendCareReportEmailMock).not.toHaveBeenCalled();
    expect(txMock.deliveryRecord.create).not.toHaveBeenCalled();
  });

  it('returns the external failure response when keyed idempotency completion cannot be persisted', async () => {
    sendCareReportEmailMock.mockRejectedValueOnce(new Error('SES unavailable'));
    txMock.careReportSendRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest(
        {
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          safety_ack: true,
        },
        { 'idempotency-key': 'send-key-failure' },
      ),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_EMAIL_SEND_FAILED',
      details: {
        provider: 'ses',
        deliveries: [{ delivery_record_id: 'delivery_1', status: 'failed' }],
      },
    });
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'care_report.send_idempotency_completion_failed',
        code: 'CARE_REPORT_SEND_IDEMPOTENCY_COMPLETION_FAILED',
        entityId: 'report_1',
        targetId: 'send_request_1',
        status: 502,
        count: 0,
      }),
    );
  });

  it('keeps the report awaiting response when a bulk send partially fails', async () => {
    txMock.deliveryRecord.create
      .mockResolvedValueOnce({ id: 'delivery_success', status: 'draft' })
      .mockResolvedValueOnce({ id: 'delivery_failed', status: 'draft' });
    txMock.careReport.updateMany.mockResolvedValueOnce({ count: 1 });
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
    expect(txMock.careReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'report_1',
          org_id: 'org_1',
          status: 'confirmed',
          updated_at: REPORT_UPDATED_AT,
        },
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
                failure_reason: EMAIL_DELIVERY_FAILURE_REASON,
              }),
            ],
          }),
        }),
      }),
    );
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
            failure_reason: EMAIL_DELIVERY_FAILURE_REASON,
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
      updated_at: REPORT_UPDATED_AT,
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
      updated_at: REPORT_UPDATED_AT,
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
      updated_at: REPORT_UPDATED_AT,
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
