import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { requireAuthContextMock, patientFindManyMock, recordDataExportAuditMock } = vi.hoisted(
  () => ({
    requireAuthContextMock: vi.fn(),
    patientFindManyMock: vi.fn(),
    recordDataExportAuditMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (req: NextRequest, ctx: Record<string, unknown>) => Promise<Response>,
      options?: unknown,
    ) =>
    async (req: NextRequest) => {
      const noStore = (response: Response) => {
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
      };
      try {
        const authResult = await requireAuthContextMock(req, options);
        if ('response' in authResult) return noStore(authResult.response);
        const response = noStore(await handler(req, authResult.ctx));
        response.headers.set('x-request-id', authResult.ctx.requestId);
        response.headers.set('x-correlation-id', authResult.ctx.correlationId);
        return response;
      } catch {
        return noStore(
          Response.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          ),
        );
      }
    },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: patientFindManyMock,
    },
  },
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function callGET(request: NextRequest) {
  return GET(request, emptyRouteContext);
}

function createRequest(url: string) {
  return new NextRequest(url);
}

describe('/api/patients/export GET', () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    vi.useRealTimers();
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        requestId: 'request_patient_export_1',
        correlationId: 'correlation_patient_export_1',
      },
    });
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '青葉 花子',
        name_kana: 'アオバ ハナコ',
        birth_date: new Date('1950-01-01T15:30:00.000Z'),
        gender: 'female',
        phone: '090-0000-0000',
        medical_insurance_number: 'med-1',
        care_insurance_number: 'care-1',
        created_at: new Date('2026-04-01T15:30:00.000Z'),
        residences: [{ address: '東京都新宿区1-1-1' }],
        cases: [{ status: 'active' }],
      },
    ]);
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('selects the filtered case status when exporting with case_status', async () => {
    const response = await callGET(
      createRequest('http://localhost/api/patients/export?case_status=active'),
    );

    if (!response) throw new Error('response is required');
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cases: {
            some: {
              status: 'active',
            },
          },
        },
        include: expect.objectContaining({
          cases: {
            where: {
              AND: [{ status: 'active' }],
            },
            orderBy: { created_at: 'desc' },
            select: { status: true },
            take: 1,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'patient_list',
        targetId: 'org_1',
        format: 'csv',
        recordCount: 1,
        filters: expect.objectContaining({
          case_status: 'active',
          truncated: false,
        }),
        requestId: 'request_patient_export_1',
        correlationId: 'correlation_patient_export_1',
      }),
    );
    expect(response.headers.get('X-Request-Id')).toBe('request_patient_export_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_patient_export_1');
    const csv = await response.text();
    expect(csv).toContain('active');
    expect(csv).toContain('1950-01-02');
    expect(csv).toContain('2026-04-02');
  });

  it('neutralizes spreadsheet formula prefixes in exported patient cells', async () => {
    patientFindManyMock.mockResolvedValue([
      {
        id: '=patient_1',
        name: '+青葉 花子',
        name_kana: '@アオバ ハナコ',
        birth_date: new Date('1950-01-01T00:00:00.000Z'),
        gender: 'female',
        phone: '\t090-0000-0000',
        medical_insurance_number: '-med-1',
        care_insurance_number: '=care-1',
        created_at: new Date('2026-04-01T00:00:00.000Z'),
        residences: [{ address: '\r東京都新宿区1-1-1' }],
        cases: [{ status: 'active' }],
      },
    ]);

    const response = await callGET(createRequest('http://localhost/api/patients/export'));

    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain("'=patient_1");
    expect(csv).toContain("'+青葉 花子");
    expect(csv).toContain("'@アオバ ハナコ");
    expect(csv).toContain("'\t090-0000-0000");
    expect(csv).toContain("'-med-1");
    expect(csv).toContain("'=care-1");
    expect(csv).toContain("'\r東京都新宿区1-1-1");
    expect(csv).not.toContain('\r\n=patient_1,');
    expect(csv).not.toContain(',+青葉 花子,');
  });

  it('masks direct identifiers for visit-only export roles', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        orgId: 'org_1',
        userId: 'trainee_1',
        role: 'pharmacist_trainee',
        requestId: 'request_patient_export_trainee',
        correlationId: 'correlation_patient_export_trainee',
      },
    });

    const response = await callGET(createRequest('http://localhost/api/patients/export'));

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const csv = await response.text();
    expect(csv).toContain('***-****-0000');
    expect(csv).toContain('***-d-1');
    expect(csv).toContain('***-e-1');
    expect(csv).toContain('東京都新宿区***');
    expect(csv).not.toContain('090-0000-0000');
    expect(csv).not.toContain('med-1');
    expect(csv).not.toContain('care-1');
    expect(csv).not.toContain('東京都新宿区1-1-1');
  });

  it('uses the local pharmacy calendar day in the export filename', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T15:30:00.000Z'));

    const response = await callGET(createRequest('http://localhost/api/patients/export'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="patients_2026-04-02.csv"',
    );
  });

  it('does not add assignment filtering for admin export', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'admin_1',
        role: 'admin',
        requestId: 'request_patient_export_admin',
        correlationId: 'correlation_patient_export_admin',
      },
    });

    const response = await callGET(createRequest('http://localhost/api/patients/export'));

    expect(response.status).toBe(200);
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
        },
      }),
    );
  });

  it('rejects an invalid case status before exporting patients', async () => {
    const response = await callGET(
      createRequest('http://localhost/api/patients/export?case_status=archived'),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_patient_export_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_patient_export_1');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        case_status: ['対応していないステータスです'],
      },
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when patient export loading fails', async () => {
    const rawError = '患者 青葉花子 insurance=12345678 export failure';
    patientFindManyMock.mockRejectedValueOnce(new Error(rawError));

    const response = await callGET(createRequest('http://localhost/api/patients/export'));

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain(rawError);
    expect(body).not.toContain('青葉花子');
    expect(body).not.toContain('12345678');
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
