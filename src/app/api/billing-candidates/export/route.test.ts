import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const emptyRouteContext = { params: Promise.resolve({}) };
const authContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'admin',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

type AuthenticatedRouteHandler = ((
  req: NextRequest,
  routeContext?: typeof emptyRouteContext,
) => Promise<Response>) & {
  authOptions?: {
    permission?: string;
    message?: string;
  };
};

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: typeof authContext,
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
    options?: AuthenticatedRouteHandler['authOptions'],
  ) =>
    Object.assign(
      (req: NextRequest, routeContext = emptyRouteContext) =>
        handler(req, authContext, routeContext),
      { authOptions: options },
    ),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url);
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

describe('/api/billing-candidates/export GET', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
          site_id: 'site_1',
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

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('billing_home_care_2026-03.csv');

    const csv = await response.text();
    expect(csv).toContain('patient_name');
    expect(csv).toContain('billing_domain');
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
          billing_domain: 'home_care',
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

  it('exports claims XML with no-store headers and claims-specific audit format', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&format=claims-xml',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(response.headers.get('content-disposition')).toContain('billing_home_care_2026-03.xml');
    await expect(response.text()).resolves.toContain('siteId="site_1"');
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(2);
    expect(recordDataExportAuditMock).toHaveBeenNthCalledWith(
      1,
      txMock,
      expect.objectContaining({
        targetType: 'billing_candidate',
        format: 'claims-xml',
        metadata: expect.objectContaining({
          export_format: 'claims-xml',
          audit_phase: 'attempt',
        }),
      }),
    );
    expect(recordDataExportAuditMock).toHaveBeenNthCalledWith(
      2,
      txMock,
      expect.objectContaining({
        targetType: 'billing_candidate',
        format: 'claims-xml',
        metadata: expect.objectContaining({
          export_format: 'claims-xml',
          audit_phase: 'success',
          claims_record_count: 1,
          site_id: 'site_1',
        }),
      }),
    );
  });

  it('rejects claims XML export before audit when candidate site cannot be resolved', async () => {
    txMock.billingCandidate.findMany.mockResolvedValueOnce([
      {
        id: 'candidate_missing_site',
        patient_id: 'patient_1',
        cycle_id: 'cycle_1',
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        billing_code: 'MED_HOME_VISIT_SINGLE',
        billing_name: '在宅患者訪問薬剤管理指導料',
        points: 650,
        status: 'confirmed',
        source_snapshot: { payer_basis: 'medical' },
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&format=claims-xml',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(422);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CLAIMS_EXPORT_SITE_UNRESOLVED',
      details: {
        reason: 'missing_site_id',
        missing_count: 1,
      },
    });
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('rejects claims XML export when candidates span multiple pharmacy sites', async () => {
    txMock.billingCandidate.findMany.mockResolvedValueOnce([
      {
        id: 'candidate_site_1',
        patient_id: 'patient_1',
        cycle_id: 'cycle_1',
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        billing_code: 'MED_HOME_VISIT_SINGLE',
        billing_name: '在宅患者訪問薬剤管理指導料',
        points: 650,
        status: 'confirmed',
        source_snapshot: { payer_basis: 'medical', site_id: 'site_1' },
      },
      {
        id: 'candidate_site_2',
        patient_id: 'patient_1',
        cycle_id: 'cycle_1',
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        billing_code: 'MED_HOME_VISIT_SINGLE',
        billing_name: '在宅患者訪問薬剤管理指導料',
        points: 650,
        status: 'confirmed',
        source_snapshot: { payer_basis: 'medical', site_id: 'site_2' },
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&format=claims-xml',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(422);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CLAIMS_EXPORT_SITE_UNRESOLVED',
      details: {
        reason: 'multiple_site_ids',
        site_count: 2,
      },
    });
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('records a durable claims XML audit before the external adapter and returns adapter failures', async () => {
    vi.stubEnv('RECECOM_CLAIMS_BASE_URL', 'https://rececom.example.test');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: 'upstream down' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&format=claims-xml',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(502);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CLAIMS_EXPORT_FAILED',
      details: { code: 'UPSTREAM_FAILURE' },
    });
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        format: 'claims-xml',
        metadata: expect.objectContaining({
          export_format: 'claims-xml',
          audit_phase: 'attempt',
        }),
      }),
    );
  });

  it('fails closed before invoking the claims XML adapter when export audit cannot be recorded', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<ClaimsExport />', {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      }),
    );
    vi.stubEnv('RECECOM_CLAIMS_BASE_URL', 'https://rececom.example.test');
    vi.stubGlobal('fetch', fetchMock);
    recordDataExportAuditMock.mockRejectedValueOnce(new Error('audit down'));

    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&format=claims-xml',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'BILLING_EXPORT_AUDIT_FAILED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['csv export', ''],
    ['claims xml export', '&format=claims-xml'],
  ])('rejects %s when there are no confirmed or exported candidates', async (_caseName, suffix) => {
    txMock.billingCandidate.findMany.mockResolvedValueOnce([]);

    const response = await GET(
      createRequest(
        `http://localhost/api/billing-candidates/export?billing_month=2026-03-01${suffix}`,
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      message: '確定済みまたは締め済みの請求候補がないためエクスポートできません',
      details: {
        billing_month: '2026-03-01',
        patient_filter: null,
        billing_domain: 'home_care',
        statuses: ['confirmed', 'exported'],
      },
    });
    expect(JSON.stringify(body)).not.toContain('patient_1');
    expect(txMock.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
          billing_domain: 'home_care',
          status: { in: ['confirmed', 'exported'] },
        }),
      }),
    );
    expect(txMock.patient.findMany).not.toHaveBeenCalled();
    expect(txMock.residence.findMany).not.toHaveBeenCalled();
    expect(txMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns a PHI-minimal export preview without data export audit side effects', async () => {
    txMock.billingCandidate.findMany.mockResolvedValueOnce([
      {
        billing_domain: 'home_care',
        points: 650,
        quantity: 2,
        status: 'confirmed',
        exclusion_reason: null,
        calculation_breakdown: {},
        source_snapshot: { payer_basis: 'medical' },
      },
      {
        billing_domain: 'home_care',
        points: 420,
        quantity: 1,
        status: 'exported',
        exclusion_reason: null,
        calculation_breakdown: {},
        source_snapshot: { payer_basis: 'care' },
      },
      {
        billing_domain: 'home_care',
        points: null,
        quantity: 1,
        status: 'candidate',
        exclusion_reason: null,
        calculation_breakdown: {},
        source_snapshot: { payer_basis: 'medical' },
      },
      {
        billing_domain: 'home_care',
        points: null,
        quantity: 1,
        status: 'excluded',
        exclusion_reason: '報告書送付が未完了です',
        calculation_breakdown: {},
        source_snapshot: { payer_basis: 'medical' },
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&preview=1',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        billing_month: '2026-03-01',
        billing_domain: 'home_care',
        total_count: 4,
        exportable_count: 2,
        total_points: 1720,
        total_amount_yen: 0,
        status_counts: {
          confirmed: 1,
          exported: 1,
          candidate: 1,
          excluded: 1,
        },
        insurance_type_counts: {
          medical: 1,
          care: 1,
          self: 0,
        },
        exclusion_reasons: [{ reason: '報告書送付が未完了です', count: 1 }],
      },
    });
    expect(txMock.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
          billing_domain: 'home_care',
        },
        select: expect.not.objectContaining({
          patient_id: true,
        }),
      }),
    );
    expect(txMock.patient.findMany).not.toHaveBeenCalled();
    expect(txMock.residence.findMany).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('treats explicit preview=false as a normal CSV export', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&preview=false',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-type')).toContain('text/csv');
    await expect(response.text()).resolves.toContain('patient_name');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ format: 'csv' }),
    );
  });

  it.each([
    [
      'billing_month duplicate',
      'billing_month=2026-03-01&billing_month=2026-04-01',
      {
        billing_month: ['billing_month は1つだけ指定してください'],
      },
    ],
    ['patient_id', 'patient_id=', { patient_id: ['patient_id を指定してください'] }],
    ['blank patient_id', 'patient_id=%20%20', { patient_id: ['patient_id を指定してください'] }],
    [
      'padded patient_id',
      'patient_id=%20patient_1',
      { patient_id: ['patient_id の形式が不正です'] },
    ],
    [
      'patient_id duplicate',
      'patient_id=patient_1&patient_id=patient_2',
      { patient_id: ['patient_id は1つだけ指定してください'] },
    ],
    [
      'billing_domain',
      'billing_domain=',
      { billing_domain: ['billing_domain を指定してください'] },
    ],
    [
      'padded billing_domain',
      'billing_domain=home_care%20',
      { billing_domain: ['billing_domain は home_care または pca_rental を指定してください'] },
    ],
    [
      'billing_domain duplicate',
      'billing_domain=home_care&billing_domain=pca_rental',
      { billing_domain: ['billing_domain は1つだけ指定してください'] },
    ],
    ['format', 'format=', { format: ['format は csv または claims-xml を指定してください'] }],
    [
      'padded format',
      'format=csv%20',
      { format: ['format は csv または claims-xml を指定してください'] },
    ],
    [
      'format duplicate',
      'format=csv&format=claims-xml',
      { format: ['format は1つだけ指定してください'] },
    ],
    [
      'preview',
      'preview=',
      { preview: ['preview は 0, 1, false, true のいずれかを指定してください'] },
    ],
    [
      'padded preview',
      'preview=true%20',
      { preview: ['preview は 0, 1, false, true のいずれかを指定してください'] },
    ],
    [
      'preview duplicate',
      'preview=1&preview=0',
      { preview: ['preview は1つだけ指定してください'] },
    ],
  ])('rejects malformed explicit %s before export side effects', async (_name, query, details) => {
    const response = await GET(
      createRequest(`http://localhost/api/billing-candidates/export?${query}`),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details,
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported format', 'format=json', 'format は csv または claims-xml を指定してください'],
    [
      'unsupported preview',
      'preview=yes',
      'preview は 0, 1, false, true のいずれかを指定してください',
    ],
  ])('rejects %s before export side effects', async (_name, query, message) => {
    const response = await GET(
      createRequest(`http://localhost/api/billing-candidates/export?${query}`),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message,
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
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
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain('"candidate_malformed_snapshot"');
    const [header, row] = csv.split('\n').map(parseCsvLine);
    const effectiveRevisionIndex = header?.indexOf('effective_revision_code') ?? -1;
    const siteRevisionIndex = header?.indexOf('site_config_revision_code') ?? -1;
    expect(row?.[effectiveRevisionIndex]).toBe('');
    expect(row?.[siteRevisionIndex]).toBe('');
  });

  it('exports institution-target PCA rental candidates without patient hierarchy lookup', async () => {
    txMock.billingCandidate.findMany.mockResolvedValueOnce([
      {
        id: 'candidate_pca_rental',
        patient_id: null,
        billing_domain: 'pca_rental',
        billing_target_type: 'institution',
        billing_target_id: 'institution_1',
        billing_target_name: 'みなと病院',
        cycle_id: null,
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_code: 'PCA_PUMP_RENTAL',
        billing_name: 'PCAポンプレンタル料',
        points: null,
        calculation_breakdown: {
          calculation_unit: 'yen',
          amount_yen: 12000,
        },
        status: 'confirmed',
        source_snapshot: {
          source_type: 'pca_pump_rental',
          billing_target: {
            type: 'institution',
            id: 'institution_1',
            name: 'みなと病院',
          },
        },
      },
    ]);
    txMock.patient.findMany.mockResolvedValueOnce([]);
    txMock.residence.findMany.mockResolvedValueOnce([]);

    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-06-01&billing_domain=pca_rental',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain('billing_domain');
    expect(csv).toContain('billing_target_type');
    expect(csv).toContain('amount_yen');
    expect(csv).toContain('"pca_rental"');
    expect(csv).toContain('"institution"');
    expect(csv).toContain('"institution_1"');
    expect(csv).toContain('"みなと病院"');
    expect(csv).toContain('"12000"');
    expect(txMock.patient.findMany).not.toHaveBeenCalled();
    expect(txMock.residence.findMany).not.toHaveBeenCalled();
  });

  it('does not expose patient filters in the export filename', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&patient_id=patient_1',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-disposition')).toContain('billing_home_care_2026-03.csv');
    expect(response.headers.get('content-disposition')).not.toContain('patient_1');
    expect(txMock.billingCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'patient_1',
          billing_domain: 'home_care',
        }),
      }),
    );
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        filters: expect.objectContaining({
          billing_month: '2026-03-01',
          patient_filter: 'specified',
          billing_domain: 'home_care',
          statuses: ['confirmed', 'exported'],
        }),
        metadata: expect.objectContaining({
          patient_filter_hash: expect.stringMatching(/^[a-f0-9]{16}$/),
        }),
      }),
    );
    const auditArgs = recordDataExportAuditMock.mock.calls[0]?.[1];
    expect(JSON.stringify(auditArgs?.filters)).not.toContain('patient_1');
    expect(JSON.stringify(auditArgs?.metadata)).not.toContain('patient_1');
  });

  it('rejects invalid billing_domain before entering org context', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?billing_month=2026-03-01&billing_domain=unknown',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('rejects malformed billing months before entering org context', async () => {
    const response = await GET(
      createRequest('http://localhost/api/billing-candidates/export?billing_month=2026-03'),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe patient filters before entering org context', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/billing-candidates/export?patient_id=patient_1%0D%0AContent-Length:%200',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('rejects out-of-range billing months before entering org context', async () => {
    const response = await GET(
      createRequest('http://localhost/api/billing-candidates/export?billing_month=2026-13-01'),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
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
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
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
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).not.toContain(`"=HYPERLINK(""https://example.test"")"`);
  });
});
