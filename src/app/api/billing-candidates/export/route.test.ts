import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withOrgContextMock, recordDataExportAuditMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest & { orgId: string }) => Promise<Response>) => handler,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { GET } from './route';

describe('/api/billing-candidates/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordDataExportAuditMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingCandidate: {
          findMany: vi.fn().mockResolvedValue([
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
          ]),
        },
        patient: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'patient_1',
              name: '山田 太郎',
            },
          ]),
        },
        residence: {
          findMany: vi.fn().mockResolvedValue([
            {
              patient_id: 'patient_1',
              building_id: 'building_a',
              unit_name: '201',
            },
          ]),
        },
        prescriptionIntake: {
          findMany: vi.fn().mockResolvedValue([
            {
              cycle_id: 'cycle_1',
              lines: [{ drug_code: '2149001' }, { drug_code: '1149019' }, { drug_code: '2149001' }],
            },
          ]),
        },
      }),
    );
  });

  it('exports billing candidates with patient hierarchy and YJ codes', async () => {
    const response = await GET({
      orgId: 'org_1',
      url: 'http://localhost/api/billing-candidates/export?billing_month=2026-03-01',
    } as unknown as NextRequest & { orgId: string });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');

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
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        targetType: 'billing_candidate',
        format: 'csv',
        recordCount: 1,
      }),
    );
  });
});
