import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  patientFindFirstMock,
  careCaseFindManyMock,
  prescriptionIntakeFindManyMock,
  recordDataExportAuditMock,
} = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
  },
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/prescriptions/export');
}

describe('/api/patients/[id]/prescriptions/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    prescriptionIntakeFindManyMock.mockResolvedValue([]);
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns 404 when the patient is not assigned to the requesting user', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(404);
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the user has no accessible cases for the patient', async () => {
    careCaseFindManyMock.mockResolvedValue([]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(403);
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('emits CSV with BOM and audit log on success', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_1',
        source_type: 'paper',
        prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
        prescriber_name: '医師A',
        prescriber_institution: '病院X',
        prescription_expiry_date: null,
        lines: [
          {
            line_number: 1,
            drug_name: 'アスピリン',
            drug_code: 'YJ001',
            dosage_form: '錠',
            dose: '1錠',
            frequency: '毎食後',
            days: 7,
            quantity: 21,
            unit: '錠',
            is_generic: false,
            notes: null,
          },
        ],
      },
    ]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('アスピリン');
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
  });
});
