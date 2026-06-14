import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, patientFindManyMock, recordDataExportAuditMock } = vi.hoisted(
  () => ({
    requireAuthContextMock: vi.fn(),
    patientFindManyMock: vi.fn(),
    recordDataExportAuditMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
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
    const response = await GET(
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
      }),
    );
    const csv = await response.text();
    expect(csv).toContain('active');
    expect(csv).toContain('1950-01-02');
    expect(csv).toContain('2026-04-02');
  });

  it('uses the local pharmacy calendar day in the export filename', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T15:30:00.000Z'));

    const response = await GET(createRequest('http://localhost/api/patients/export'));

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
      },
    });

    const response = await GET(createRequest('http://localhost/api/patients/export'));

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
    const response = await GET(
      createRequest('http://localhost/api/patients/export?case_status=archived'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        case_status: ['対応していないステータスです'],
      },
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
