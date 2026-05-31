import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withOrgContextMock, recordDataExportAuditMock, txMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  txMock: {
    billingCandidate: {
      findMany: vi.fn(),
    },
    patient: {
      findMany: vi.fn(),
    },
    residence: {
      findMany: vi.fn(),
    },
    prescriptionIntake: {
      findMany: vi.fn(),
    },
  },
}));

type AuthenticatedRouteHandler = ((req: NextRequest & { orgId: string }) => Promise<Response>) & {
  authOptions?: {
    permission?: string;
    message?: string;
  };
};

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (req: NextRequest & { orgId: string }) => Promise<Response>,
    options?: AuthenticatedRouteHandler['authOptions'],
  ) => Object.assign(handler, { authOptions: options }),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { GET } from './route';

function createRequest(url: string) {
  return Object.assign(new NextRequest(url), { orgId: 'org_1' });
}

describe('/api/billing-candidates/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordDataExportAuditMock.mockResolvedValue(undefined);
    txMock.billingCandidate.findMany.mockResolvedValue([
      {
        id: 'candidate_1',
        patient_id: 'patient_1',
        cycle_id: 'cycle_1',
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        billing_code: 'MED_HOME_VISIT_SINGLE',
        billing_name: '在宅患者訪問薬剤管理指導料 単一建物1人',
        points: 650,
        status: 'confirmed',
        source_snapshot: {
          revision_code: '2026',
          site_config_revision_code: '2026',
        },
      },
    ]);
    txMock.patient.findMany.mockResolvedValue([
      {
        id: 'patient_1',
        name: '山田 太郎',
      },
    ]);
    txMock.residence.findMany.mockResolvedValue([
      {
        patient_id: 'patient_1',
        building_id: 'building_a',
        unit_name: '201',
      },
    ]);
    txMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        cycle_id: 'cycle_1',
        lines: [{ drug_code: '2149001' }, { drug_code: '1149019' }, { drug_code: '2149001' }],
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
  });

  it('requires billing management permission for CSV export', () => {
    expect((GET as AuthenticatedRouteHandler).authOptions).toMatchObject({
      permission: 'canManageBilling',
      message: '請求候補のエクスポート権限がありません',
    });
  });

  it('exports billing candidates with patient hierarchy and YJ codes', async () => {
    const response = await GET(
      createRequest('http://localhost/api/billing-candidates/export?billing_month=2026-03-01'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('billing_2026-03.csv');

    const csv = await response.text();
    expect(csv).toContain('patient_name');
    expect(csv).toContain('building_id');
    expect(csv).toContain('unit_name');
    expect(csv).toContain('yj_codes');
    expect(csv).toContain('"山田 太郎"');
    expect(csv).toContain('"building_a"');
    expect(csv).toContain('"201"');
    expect(csv).toContain('effective_revision_code');
    expect(csv).toContain('"2026"');
    expect(csv).toContain('"1149019|2149001"');
    expect(txMock.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
          status: { in: ['confirmed', 'exported'] },
        }),
      }),
    );
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        targetType: 'billing_candidate',
        format: 'csv',
        recordCount: 1,
      }),
    );
  });

  it('exports empty source snapshot metadata for malformed source snapshots', async () => {
    txMock.billingCandidate.findMany.mockResolvedValueOnce([
      {
        id: 'candidate_malformed_snapshot',
        patient_id: 'patient_1',
        cycle_id: 'cycle_1',
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        billing_code: 'MED_HOME_VISIT_SINGLE',
        billing_name: '在宅患者訪問薬剤管理指導料 単一建物1人',
        points: 650,
        status: 'confirmed',
        source_snapshot: ['unexpected'],
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/billing-candidates/export?billing_month=2026-03-01'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain('"candidate_malformed_snapshot"');
    expect(csv.split('\n')[1]?.split(',').slice(8, 10)).toEqual(['""', '""']);
  });

  it('does not expose patient filters in the export filename', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&patient_id=patient_1',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('billing_2026-03.csv');
    expect(response.headers.get('content-disposition')).not.toContain('patient_1');
    expect(txMock.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'patient_1',
        }),
      }),
    );
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        filters: expect.objectContaining({
          billing_month: '2026-03-01',
          patient_id: 'patient_1',
          statuses: ['confirmed', 'exported'],
        }),
      }),
    );
  });

  it('rejects malformed billing months before entering org context', async () => {
    const response = await GET(
      createRequest('http://localhost/api/billing-candidates/export?billing_month=2026-03'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe patient filters before entering org context', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?patient_id=patient_1%0D%0AContent-Length:%200',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('rejects out-of-range billing months before entering org context', async () => {
    const response = await GET(
      createRequest('http://localhost/api/billing-candidates/export?billing_month=2026-13-01'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty query value', ''],
    ['non-month-start date', '2026-03-02'],
    ['invalid calendar date', '2026-02-30'],
    ['timezone timestamp', '2026-03-01T00:00:00.000Z'],
  ])('rejects %s billing_month before export side effects', async (_caseName, billingMonth) => {
    const response = await GET(
      createRequest(
        `http://localhost/api/billing-candidates/export?billing_month=${encodeURIComponent(
          billingMonth,
        )}`,
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('neutralizes spreadsheet formula prefixes in CSV cells', async () => {
    txMock.patient.findMany.mockResolvedValueOnce([
      {
        id: 'patient_1',
        name: '=HYPERLINK("https://example.test")',
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/billing-candidates/export?billing_month=2026-03-01'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).not.toContain(`"=HYPERLINK(""https://example.test"")"`);
  });
});
