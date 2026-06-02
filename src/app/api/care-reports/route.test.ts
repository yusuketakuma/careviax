import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  careReportCreateMock,
  careReportFindManyMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  patientFindFirstMock,
  patientFindManyMock,
  visitRecordFindFirstMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  careReportCreateMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (
      req: NextRequest & { orgId: string; userId: string; role?: string },
    ) => Promise<Response>,
  ) => {
    withAuthMock.mockImplementation(handler);
    return handler;
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careReport: {
      create: careReportCreateMock,
      findMany: careReportFindManyMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: careCaseFindManyMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
      findMany: patientFindManyMock,
    },
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/prescriptions/prescriber-institutions', () => ({
  findLatestPrescriberInstitutionSuggestion: vi.fn().mockResolvedValue(null),
}));

import { GET, POST } from './route';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role?: string;
};

function createAuthenticatedRequest(
  url = 'http://localhost/api/care-reports',
  init?: ConstructorParameters<typeof NextRequest>[1],
  auth: { orgId: string; userId: string; role?: string } = {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
  },
): AuthenticatedTestRequest {
  return Object.assign(new NextRequest(url, init), auth);
}

describe('/api/care-reports GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careReportFindManyMock.mockResolvedValue([
      {
        id: 'report_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        status: 'response_waiting',
        content: {
          summary: '服薬状況は安定。夜間の眠気について経過観察。',
          billing_context: {
            effective_revision_code: '2026',
            site_config_status: 'resolved',
          },
        },
        template_id: null,
        pdf_url: null,
        created_by: 'user_1',
        created_at: new Date('2026-03-28T09:00:00.000Z'),
        updated_at: new Date('2026-03-28T09:15:00.000Z'),
        delivery_records: [
          {
            id: 'delivery_1',
            channel: 'fax',
            recipient_name: '在宅主治医',
            status: 'response_waiting',
            sent_at: new Date('2026-03-28T11:00:00.000Z'),
            created_at: new Date('2026-03-28T10:30:00.000Z'),
          },
          {
            id: 'delivery_2',
            channel: 'fax',
            recipient_name: '在宅主治医',
            status: 'failed',
            sent_at: null,
            created_at: new Date('2026-03-28T10:00:00.000Z'),
          },
        ],
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      { id: 'patient_1', name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
    ]);
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_1',
      backup_pharmacist_id: null,
      required_visit_support: null,
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      schedule: {
        case_id: 'case_1',
        pharmacist_id: 'user_1',
        case_: {
          primary_pharmacist_id: 'user_1',
          backup_pharmacist_id: null,
        },
      },
    });
    careReportCreateMock.mockResolvedValue({
      id: 'report_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_1',
      report_type: 'physician_report',
      status: 'draft',
      content: {},
      created_by: 'user_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careReport: {
          create: careReportCreateMock,
        },
      }),
    );
  });

  it('supports extended report search filters and enriches delivery summary', async () => {
    const response = await GET(
      createAuthenticatedRequest(
        'http://localhost/api/care-reports?q=山田&keyword=眠気&visit_record_id=visit_1&report_type=physician_report&delivery_status=response_waiting&recipient=主治医&date_from=2026-03-01&date_to=2026-03-31&sent_from=2026-03-28&sent_to=2026-03-29',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          visit_record_id: 'visit_1',
          report_type: 'physician_report',
          AND: [
            {
              OR: [
                { case_id: { in: ['case_1'] } },
                { case_id: null, patient_id: { in: ['patient_1'] } },
              ],
            },
          ],
          delivery_records: {
            some: expect.objectContaining({
              status: 'response_waiting',
              recipient_name: { contains: '主治医', mode: 'insensitive' },
            }),
          },
        }),
      }),
    );

    const payload = (await response.json()) as {
      data: Array<{
        patient_name: string;
        latest_delivery_status: string | null;
        latest_delivery_recipient_name: string | null;
        failed_delivery_count: number;
        pending_delivery_count: number;
        effective_revision_code: string | null;
        site_config_status: string | null;
      }>;
      deliverySummary: {
        pending_delivery_count: number;
        failed_delivery_count: number;
        by_status: Record<string, number>;
      };
    };

    expect(payload.data[0]).toMatchObject({
      patient_name: '山田 太郎',
      latest_delivery_status: 'response_waiting',
      latest_delivery_recipient_name: '在宅主治医',
      failed_delivery_count: 1,
      pending_delivery_count: 1,
      effective_revision_code: '2026',
      site_config_status: 'resolved',
    });
    expect(payload.deliverySummary).toMatchObject({
      pending_delivery_count: 1,
      failed_delivery_count: 1,
      by_status: { response_waiting: 1 },
    });
  });

  it('trims patient and visit record filters before report lookup', async () => {
    const response = await GET(
      createAuthenticatedRequest(
        'http://localhost/api/care-reports?patient_id=%20patient_1%20&visit_record_id=%20visit_1%20',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'patient_1',
          visit_record_id: 'visit_1',
        }),
      }),
    );
  });

  it('normalizes malformed billing context metadata while enriching reports', async () => {
    careReportFindManyMock.mockResolvedValueOnce([
      {
        id: 'report_invalid_billing_context',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        status: 'draft',
        content: {
          summary: '訪問後報告',
          billing_context: ['unexpected'],
        },
        template_id: null,
        pdf_url: null,
        created_by: 'user_1',
        created_at: new Date('2026-03-28T09:00:00.000Z'),
        updated_at: new Date('2026-03-28T09:15:00.000Z'),
        delivery_records: [],
      },
    ]);

    const response = await GET(createAuthenticatedRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      data: Array<{
        effective_revision_code: string | null;
        site_config_status: string | null;
      }>;
    };

    expect(payload.data[0]).toMatchObject({
      effective_revision_code: null,
      site_config_status: null,
    });
  });

  it('returns an empty scoped result without reading reports when a non-admin has no assigned cases', async () => {
    careCaseFindManyMock.mockResolvedValueOnce([]);
    careReportFindManyMock.mockResolvedValueOnce([]);

    const response = await GET(
      createAuthenticatedRequest('http://localhost/api/care-reports', undefined, {
        orgId: 'org_1',
        userId: 'unassigned_1',
        role: 'pharmacist',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          AND: [{ id: { in: [] } }],
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });
  });

  it('returns 400 for an invalid status filter', async () => {
    const response = await GET(
      createAuthenticatedRequest('http://localhost/api/care-reports?status=unknown'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careReportFindManyMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid date filter', async () => {
    const response = await GET(
      createAuthenticatedRequest('http://localhost/api/care-reports?sent_from=2026-03-99'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careReportFindManyMock).not.toHaveBeenCalled();
  });
});

describe('/api/care-reports POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_1',
      backup_pharmacist_id: null,
      required_visit_support: null,
    });
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      schedule: {
        case_id: 'case_1',
        pharmacist_id: 'user_1',
        case_: {
          primary_pharmacist_id: 'user_1',
          backup_pharmacist_id: null,
        },
      },
    });
    careReportCreateMock.mockResolvedValue({
      id: 'report_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_1',
      report_type: 'physician_report',
      status: 'draft',
      content: {},
      created_by: 'user_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careReport: {
          create: careReportCreateMock,
        },
      }),
    );
  });

  function createPostRequest(body: unknown) {
    return createAuthenticatedRequest('http://localhost/api/care-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function createMalformedPostRequest() {
    return createAuthenticatedRequest('http://localhost/api/care-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"patient_id":',
    });
  }

  it('creates a report only when patient, case, and visit record belong together', async () => {
    const response = await POST(
      createPostRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        content: { summary: '訪問後報告' },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(careCaseFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case_1', org_id: 'org_1', patient_id: 'patient_1' },
      }),
    );
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visit_1', org_id: 'org_1', patient_id: 'patient_1' },
      }),
    );
    expect(careReportCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          created_by: 'user_1',
          patient_id: 'patient_1',
          case_id: 'case_1',
          visit_record_id: 'visit_1',
          content: { summary: '訪問後報告' },
        }),
      }),
    );
  });

  it('normalizes source IDs before validation and persistence', async () => {
    const response = await POST(
      createPostRequest({
        patient_id: ' patient_1 ',
        case_id: ' case_1 ',
        visit_record_id: ' visit_1 ',
        report_type: 'physician_report',
        content: { summary: '訪問後報告' },
        template_id: ' template_1 ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(careCaseFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case_1', org_id: 'org_1', patient_id: 'patient_1' },
      }),
    );
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visit_1', org_id: 'org_1', patient_id: 'patient_1' },
      }),
    );
    expect(careReportCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patient_id: 'patient_1',
          case_id: 'case_1',
          visit_record_id: 'visit_1',
          template_id: 'template_1',
        }),
      }),
    );
  });

  it('stores the visit schedule case when creating from a visit record', async () => {
    const response = await POST(
      createPostRequest({
        patient_id: 'patient_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        content: { summary: '訪問後報告' },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(careReportCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patient_id: 'patient_1',
          case_id: 'case_1',
          visit_record_id: 'visit_1',
        }),
      }),
    );
  });

  it('rejects report creation from an unassigned visit record before writing', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      schedule: {
        case_id: 'case_1',
        pharmacist_id: 'other_user',
        case_: {
          primary_pharmacist_id: 'other_user',
          backup_pharmacist_id: null,
        },
      },
    });

    const response = await POST(
      createPostRequest({
        patient_id: 'patient_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        content: { summary: '訪問後報告' },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects reports for a case that does not belong to the patient', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createPostRequest({
        patient_id: 'patient_1',
        case_id: 'case_other',
        report_type: 'care_manager_report',
        content: {},
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects reports for a visit record that does not belong to the selected case', async () => {
    visitRecordFindFirstMock.mockResolvedValueOnce({
      id: 'visit_1',
      schedule: { case_id: 'case_other' },
    });

    const response = await POST(
      createPostRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        content: {},
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient IDs before source validation', async () => {
    const response = await POST(
      createPostRequest({
        patient_id: '   ',
        report_type: 'care_manager_report',
        content: {},
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
  });

  it('normalizes blank optional source fields before writing patient-only reports', async () => {
    const response = await POST(
      createPostRequest({
        patient_id: 'patient_1',
        case_id: '   ',
        visit_record_id: '   ',
        report_type: 'family_share',
        content: {},
        template_id: '   ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patient_id: 'patient_1',
          case_id: null,
        }),
      }),
    );
    expect(careReportCreateMock.mock.calls[0]?.[0].data).not.toHaveProperty('template_id', '   ');
  });

  it('rejects non-object request bodies before source validation', async () => {
    const response = await POST(createPostRequest(['unexpected']));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before source validation', async () => {
    const response = await POST(createMalformedPostRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object report content before source validation', async () => {
    const response = await POST(
      createPostRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        report_type: 'care_manager_report',
        content: ['unexpected'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
  });
});
