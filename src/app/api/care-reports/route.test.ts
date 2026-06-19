import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  withAuthContextMock,
  withOrgContextMock,
  careReportCreateMock,
  careReportFindFirstMock,
  careReportFindManyMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  deliveryRecordCountMock,
  deliveryRecordFindManyMock,
  deliveryRecordGroupByMock,
  patientFindFirstMock,
  patientFindManyMock,
  visitRecordFindFirstMock,
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  careReportCreateMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  deliveryRecordCountMock: vi.fn(),
  deliveryRecordFindManyMock: vi.fn(),
  deliveryRecordGroupByMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
}));

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role?: string;
};

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    withAuthContextMock.mockImplementation(handler);
    return (req: AuthenticatedTestRequest, routeContext = emptyRouteContext) =>
      handler(
        req,
        {
          orgId: req.orgId,
          userId: req.userId,
          role: (req.role ?? 'pharmacist') as 'pharmacist',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careReport: {
      create: careReportCreateMock,
      findFirst: careReportFindFirstMock,
      findMany: careReportFindManyMock,
    },
    deliveryRecord: {
      count: deliveryRecordCountMock,
      findMany: deliveryRecordFindManyMock,
      groupBy: deliveryRecordGroupByMock,
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

function getCareReports(req: AuthenticatedTestRequest) {
  return GET(req, emptyRouteContext);
}

function createCareReport(req: AuthenticatedTestRequest) {
  return POST(req, emptyRouteContext);
}

describe('/api/care-reports GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careReportFindFirstMock.mockResolvedValue(null);
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
          source_provenance: {
            visit_record_id: 'hidden_visit_record_1',
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
    deliveryRecordCountMock.mockResolvedValue(1);
    deliveryRecordGroupByMock.mockResolvedValue([
      {
        report_id: 'report_1',
        _max: {
          created_at: new Date('2026-03-28T10:30:00.000Z'),
        },
      },
    ]);
    deliveryRecordFindManyMock.mockResolvedValue([
      {
        id: 'delivery_1',
        report_id: 'report_1',
        status: 'response_waiting',
        created_at: new Date('2026-03-28T10:30:00.000Z'),
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
      version: 2,
      updated_at: new Date('2026-03-28T08:45:00.000Z'),
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
    const response = await getCareReports(
      createAuthenticatedRequest(
        'http://localhost/api/care-reports?q=山田&keyword=眠気&visit_record_id=visit_1&report_type=physician_report&delivery_status=response_waiting&recipient=主治医&date_from=2026-03-01&date_to=2026-03-31&sent_from=2026-03-28&sent_to=2026-03-29',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          content: true,
        }),
        where: expect.objectContaining({
          org_id: 'org_1',
          visit_record_id: 'visit_1',
          report_type: 'physician_report',
          patient_id: { in: ['patient_1'] },
          delivery_records: {
            some: expect.objectContaining({
              status: 'response_waiting',
              sent_at: {
                gte: new Date('2026-03-28T00:00:00.000Z'),
                lte: new Date('2026-03-29T23:59:59.999Z'),
              },
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
    expect(payload.data[0]).not.toHaveProperty('content');
    expect(payload.deliverySummary).toMatchObject({
      pending_delivery_count: 1,
      failed_delivery_count: 1,
      by_status: { response_waiting: 1 },
    });
  });

  it('redacts stored report file URLs from list rows when the caller cannot send reports', async () => {
    careReportFindManyMock.mockResolvedValueOnce([
      {
        id: 'report_with_file',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        status: 'confirmed',
        content: { summary: '訪問後報告' },
        template_id: null,
        pdf_url: '/api/files/file_1/download',
        created_by: 'user_1',
        created_at: new Date('2026-03-28T09:00:00.000Z'),
        updated_at: new Date('2026-03-28T09:15:00.000Z'),
        delivery_records: [],
      },
    ]);

    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports', undefined, {
        orgId: 'org_1',
        userId: 'clerk_1',
        role: 'clerk',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'report_with_file',
          pdf_url: null,
        },
      ],
    });
  });

  it('uses database keyset pagination for regular list pages', async () => {
    const cursorCreatedAt = new Date('2026-03-28T09:30:00.000Z');
    careReportFindFirstMock.mockResolvedValueOnce({
      id: 'report_cursor',
      created_at: cursorCreatedAt,
    });
    const firstPageRow = {
      id: 'report_page_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      visit_record_id: 'visit_1',
      report_type: 'physician_report',
      status: 'response_waiting',
      content: { summary: '訪問後報告' },
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
        },
      ],
    };
    const overflowRow = {
      ...firstPageRow,
      id: 'report_page_2',
      created_at: new Date('2026-03-28T08:00:00.000Z'),
      delivery_records: [],
    };
    careReportFindManyMock
      .mockResolvedValueOnce([firstPageRow, overflowRow])
      .mockResolvedValueOnce([firstPageRow, overflowRow]);

    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports?limit=1&cursor=report_cursor'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'report_cursor',
          org_id: 'org_1',
        }),
        select: { id: true, created_at: true },
      }),
    );
    const listCall = careReportFindManyMock.mock.calls[0]?.[0];
    expect(listCall).toMatchObject({
      take: 2,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      where: expect.objectContaining({
        org_id: 'org_1',
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: [
              { created_at: { lt: cursorCreatedAt } },
              {
                created_at: { equals: cursorCreatedAt },
                id: { lt: 'report_cursor' },
              },
            ],
          }),
        ]),
      }),
    });
    expect(listCall.select).not.toHaveProperty('content');
    const summaryCall = careReportFindManyMock.mock.calls[1]?.[0];
    expect(summaryCall).toBeUndefined();
    expect(deliveryRecordCountMock).toHaveBeenCalledWith({
      where: {
        report: { is: expect.objectContaining({ org_id: 'org_1' }) },
        status: 'failed',
      },
    });
    expect(deliveryRecordGroupByMock).toHaveBeenCalledWith({
      by: ['report_id'],
      where: {
        report: { is: expect.objectContaining({ org_id: 'org_1' }) },
      },
      _max: { created_at: true },
    });
    expect(deliveryRecordFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            report_id: 'report_1',
            created_at: new Date('2026-03-28T10:30:00.000Z'),
          },
        ],
      },
      select: {
        id: true,
        report_id: true,
        status: true,
        created_at: true,
      },
      orderBy: [{ report_id: 'asc' }, { created_at: 'desc' }, { id: 'desc' }],
    });

    const payload = await response.json();
    expect(payload).toMatchObject({
      data: [{ id: 'report_page_1' }],
      hasMore: true,
      nextCursor: 'report_page_1',
      deliverySummary: {
        pending_delivery_count: 1,
      },
    });
    expect(payload.data[0]).not.toHaveProperty('content');
  });

  it('rejects stale regular list cursors before reading list rows', async () => {
    careReportFindFirstMock.mockResolvedValueOnce(null);

    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports?cursor=missing_report'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { cursor: ['カーソルが見つかりません'] },
    });
    expect(careReportFindManyMock).not.toHaveBeenCalled();
  });

  it('summarizes regular list delivery state without rereading full report rows', async () => {
    careReportFindManyMock.mockResolvedValueOnce([
      {
        id: 'report_page_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        status: 'sent',
        template_id: null,
        pdf_url: null,
        created_by: 'user_1',
        created_at: new Date('2026-03-28T09:00:00.000Z'),
        updated_at: new Date('2026-03-28T09:15:00.000Z'),
        delivery_records: [],
      },
    ]);
    deliveryRecordCountMock.mockResolvedValueOnce(2);
    deliveryRecordGroupByMock.mockResolvedValueOnce([
      {
        report_id: 'report_page_1',
        _max: { created_at: new Date('2026-03-28T10:30:00.000Z') },
      },
      {
        report_id: 'report_page_2',
        _max: { created_at: new Date('2026-03-28T11:30:00.000Z') },
      },
    ]);
    deliveryRecordFindManyMock.mockResolvedValueOnce([
      {
        id: 'delivery_latest_1',
        report_id: 'report_page_1',
        status: 'response_waiting',
        created_at: new Date('2026-03-28T10:30:00.000Z'),
      },
      {
        id: 'delivery_latest_2',
        report_id: 'report_page_2',
        status: 'sent',
        created_at: new Date('2026-03-28T11:30:00.000Z'),
      },
    ]);

    const response = await getCareReports(createAuthenticatedRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportFindManyMock).toHaveBeenCalledTimes(1);
    expect(deliveryRecordCountMock).toHaveBeenCalledWith({
      where: {
        report: { is: expect.objectContaining({ org_id: 'org_1' }) },
        status: 'failed',
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      deliverySummary: {
        pending_delivery_count: 1,
        failed_delivery_count: 2,
        by_status: {
          response_waiting: 1,
          sent: 1,
        },
      },
    });
  });

  it('does not match keywords against hidden report metadata', async () => {
    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports?keyword=hidden_visit_record_1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
      deliverySummary: {
        pending_delivery_count: 0,
        failed_delivery_count: 0,
        by_status: {},
      },
    });
  });

  it('rejects cursor paging for body keyword searches', async () => {
    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports?keyword=眠気&cursor=report_1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { cursor: ['本文検索ではカーソルを指定できません'] },
    });
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(careReportFindManyMock).not.toHaveBeenCalled();
  });

  it('returns report content only when explicitly requested for print workflows', async () => {
    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports?include_content=1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportFindManyMock.mock.calls[0]?.[0].select).toMatchObject({
      content: true,
    });
    const payload = await response.json();
    expect(payload.data[0].content).toMatchObject({
      summary: '服薬状況は安定。夜間の眠気について経過観察。',
      source_provenance: {
        visit_record_id: 'hidden_visit_record_1',
      },
    });
  });

  it('does not return report content for include_content requests without output permission', async () => {
    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports?include_content=1', undefined, {
        orgId: 'org_1',
        userId: 'clerk_1',
        role: 'clerk',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportFindManyMock.mock.calls[0]?.[0].select).not.toHaveProperty('content');
    const payload = await response.json();
    expect(payload.data[0]).not.toHaveProperty('content');
  });

  it('rejects keyword body search without report output permission', async () => {
    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports?keyword=眠気', undefined, {
        orgId: 'org_1',
        userId: 'clerk_1',
        role: 'clerk',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '報告書本文検索の権限がありません',
    });
    expect(careReportFindManyMock).not.toHaveBeenCalled();
    expect(deliveryRecordCountMock).not.toHaveBeenCalled();
  });

  it('trims patient and visit record filters before report lookup', async () => {
    const response = await getCareReports(
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

    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports?include_content=1'),
    );

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

  it('reads org-wide reports for an org-wide role regardless of case assignment', async () => {
    careCaseFindManyMock.mockResolvedValueOnce([]);
    careReportFindManyMock.mockResolvedValueOnce([]);

    const response = await getCareReports(
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
        }),
      }),
    );
    expect(careReportFindManyMock.mock.calls[0][0].where).not.toHaveProperty('AND');
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });
  });

  it('returns 400 for an invalid status filter', async () => {
    const response = await getCareReports(
      createAuthenticatedRequest('http://localhost/api/care-reports?status=unknown'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careReportFindManyMock).not.toHaveBeenCalled();
  });

  it.each(['2026-03-99', '2026-02-29'])(
    'returns 400 for an invalid date filter: %s',
    async (sentFrom) => {
      const response = await getCareReports(
        createAuthenticatedRequest(`http://localhost/api/care-reports?sent_from=${sentFrom}`),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expect(careReportFindManyMock).not.toHaveBeenCalled();
    },
  );
});

describe('/api/care-reports POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careReportFindFirstMock.mockResolvedValue(null);
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
      version: 2,
      updated_at: new Date('2026-03-28T08:45:00.000Z'),
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
    const response = await createCareReport(
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
          content: {
            summary: '訪問後報告',
            source_provenance: expect.objectContaining({
              schema_version: 1,
              visit_record_id: 'visit_1',
              visit_record_version: 2,
              visit_record_updated_at: '2026-03-28T08:45:00.000Z',
              source: 'manual_care_report_create',
            }),
          },
        }),
      }),
    );
  });

  it('normalizes source IDs before validation and persistence', async () => {
    const response = await createCareReport(
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
    const response = await createCareReport(
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

  it('returns 409 when a report already exists for the visit record and type', async () => {
    careReportFindFirstMock.mockResolvedValueOnce({
      id: 'report_existing',
      status: 'draft',
      report_type: 'physician_report',
    });

    const response = await createCareReport(
      createPostRequest({
        patient_id: 'patient_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        content: { summary: '訪問後報告' },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この訪問記録の同一種別の報告書は既に存在します',
      details: {
        report_id: 'report_existing',
        report_type: 'physician_report',
        status: 'draft',
      },
    });
    expect(careReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
      },
      select: { id: true, status: true, report_type: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
  });

  it('maps concurrent duplicate report creation to 409', async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['org_id', 'visit_record_id', 'report_type'] },
    });
    careReportFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'report_race_winner',
      status: 'draft',
      report_type: 'physician_report',
    });
    withOrgContextMock.mockRejectedValueOnce(duplicateError);

    const response = await createCareReport(
      createPostRequest({
        patient_id: 'patient_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        content: { summary: '訪問後報告' },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この訪問記録の同一種別の報告書は既に存在します',
      details: {
        report_id: 'report_race_winner',
        report_type: 'physician_report',
        status: 'draft',
      },
    });
    expect(careReportFindFirstMock).toHaveBeenLastCalledWith({
      where: {
        org_id: 'org_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
      },
      select: { id: true, status: true, report_type: true },
    });
  });

  it('allows org-wide roles to create reports from any in-org visit record', async () => {
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

    const response = await createCareReport(
      createPostRequest({
        patient_id: 'patient_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        content: { summary: '訪問後報告' },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(careReportCreateMock).toHaveBeenCalled();
  });

  it('rejects reports for a case that does not belong to the patient', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await createCareReport(
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

    const response = await createCareReport(
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
    const response = await createCareReport(
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
    const response = await createCareReport(
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
    const response = await createCareReport(createPostRequest(['unexpected']));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before source validation', async () => {
    const response = await createCareReport(createMalformedPostRequest());

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
    const response = await createCareReport(
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
