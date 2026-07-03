import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  visitRecordFindManyMock,
  billingCandidateFindManyMock,
  patientFindManyMock,
  workbenchSummaryMock,
  upsertBillingEvidenceForVisitMock,
  generateBillingCandidatesForMonthMock,
  generatePcaRentalBillingCandidatesForMonthMock,
  japanMonthRangeForBillingMonthMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  workbenchSummaryMock: vi.fn(),
  upsertBillingEvidenceForVisitMock: vi.fn(),
  generateBillingCandidatesForMonthMock: vi.fn(),
  generatePcaRentalBillingCandidatesForMonthMock: vi.fn(),
  japanMonthRangeForBillingMonthMock: vi.fn((billingMonth: Date) => {
    const year = billingMonth.getUTCFullYear();
    const monthIndex = billingMonth.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, monthIndex, 1) - 9 * 60 * 60 * 1000),
      nextStart: new Date(Date.UTC(year, monthIndex + 1, 1) - 9 * 60 * 60 * 1000),
      end: new Date(Date.UTC(year, monthIndex + 1, 1) - 9 * 60 * 60 * 1000 - 1),
    };
  }),
}));

type AuthenticatedRouteHandler = ((req: NextRequest) => Promise<Response>) & {
  authOptions?: {
    permission?: string;
    message?: string;
  };
};

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
    ) => Promise<Response>,
    options?: AuthenticatedRouteHandler['authOptions'],
  ) =>
    Object.assign(
      (req: NextRequest) => handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }),
      { authOptions: options },
    ),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
  },
}));

vi.mock('@/server/services/billing-evidence', () => ({
  getBillingCandidateWorkbenchSummary: workbenchSummaryMock,
  upsertBillingEvidenceForVisit: upsertBillingEvidenceForVisitMock,
  generateBillingCandidatesForMonth: generateBillingCandidatesForMonthMock,
  japanMonthRangeForBillingMonth: japanMonthRangeForBillingMonthMock,
}));

vi.mock('@/server/services/pca-rental-billing', () => ({
  generatePcaRentalBillingCandidatesForMonth: generatePcaRentalBillingCandidatesForMonthMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const CANDIDATE_UPDATED_AT = '2026-06-18T00:00:00.000Z';
const GET = Object.assign((req: NextRequest) => rawGET(req, emptyRouteContext), {
  authOptions: (rawGET as unknown as AuthenticatedRouteHandler).authOptions,
});
const POST = Object.assign((req: NextRequest) => rawPOST(req, emptyRouteContext), {
  authOptions: (rawPOST as unknown as AuthenticatedRouteHandler).authOptions,
});

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/billing-candidates', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/billing-candidates', {
    method: 'POST',
    body: '{"billing_month":',
    headers: { 'content-type': 'application/json' },
  });
}

function createGetRequest(url: string) {
  return new NextRequest(url);
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/billing-candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitRecordFindManyMock.mockResolvedValue([{ id: 'visit_1' }, { id: 'visit_2' }]);
    billingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'candidate_1',
        patient_id: 'patient_1',
        status: 'confirmed',
        updated_at: new Date(CANDIDATE_UPDATED_AT),
        source_snapshot: {
          billing_close: {
            review_state: 'reviewed',
            resolution_state: 'confirmed',
          },
        },
      },
      {
        id: 'candidate_2',
        patient_id: 'patient_2',
        status: 'candidate',
        updated_at: new Date('2026-06-18T00:05:00.000Z'),
        source_snapshot: null,
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      { id: 'patient_1', name: '佐藤 花子' },
      { id: 'patient_2', name: '鈴木 一郎' },
    ]);
    workbenchSummaryMock.mockResolvedValue({
      total: 2,
      pending_review: 1,
      confirmed: 1,
      excluded: 0,
      exported: 0,
      reviewed: 1,
      ready_to_close: 1,
      blocked_from_close: 1,
      blocker_reasons: [{ reason: '同意未取得', count: 1 }],
    });
    generateBillingCandidatesForMonthMock.mockResolvedValue([
      { status: 'confirmed' },
      { status: 'candidate' },
      { status: 'excluded' },
    ]);
    generatePcaRentalBillingCandidatesForMonthMock.mockResolvedValue([{ status: 'candidate' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingCandidate: {
          findMany: billingCandidateFindManyMock,
        },
        patient: {
          findMany: patientFindManyMock,
        },
      }),
    );
  });

  it('requires billing management permission for candidate read and generation', () => {
    expect((GET as AuthenticatedRouteHandler).authOptions).toMatchObject({
      permission: 'canManageBilling',
      message: '請求候補の閲覧権限がありません',
    });
    expect((POST as AuthenticatedRouteHandler).authOptions).toMatchObject({
      permission: 'canManageBilling',
      message: '請求候補の作成権限がありません',
    });
  });

  it('returns billing candidate workbench summary for the selected month', async () => {
    billingCandidateFindManyMock.mockResolvedValueOnce([
      {
        id: 'candidate_1',
        patient_id: 'patient_1',
        status: 'confirmed',
        updated_at: new Date(CANDIDATE_UPDATED_AT),
        source_snapshot: {
          billing_close: {
            review_state: 'reviewed',
            resolution_state: 'confirmed',
          },
        },
      },
    ]);
    patientFindManyMock.mockResolvedValueOnce([{ id: 'patient_1', name: '佐藤 花子' }]);

    const response = await GET(
      createGetRequest(
        'http://localhost/api/billing-candidates?billing_month=2026-03-01&patient_id=patient_1&billing_domain=home_care&limit=10',
      ),
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expectSensitiveNoStore(resolvedResponse);
    expect(billingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          patient_id: true,
          billing_domain: true,
          billing_target_type: true,
          billing_target_id: true,
          billing_target_name: true,
          billing_month: true,
          billing_code: true,
          billing_name: true,
          points: true,
          quantity: true,
          calculation_breakdown: true,
          status: true,
          exclusion_reason: true,
          source_snapshot: true,
          updated_at: true,
        },
        where: expect.objectContaining({
          org_id: 'org_1',
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
          patient_id: 'patient_1',
          billing_domain: 'home_care',
        }),
      }),
    );
    expect(workbenchSummaryMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        orgId: 'org_1',
        billingMonth: new Date('2026-03-01T00:00:00.000Z'),
        patientId: 'patient_1',
        billingDomain: 'home_care',
      }),
    );
    expect(patientFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['patient_1'] },
      },
      select: { id: true, name: true },
    });
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      summary: {
        total: 2,
        pending_review: 1,
        confirmed: 1,
        ready_to_close: 1,
      },
      data: [
        {
          status: 'confirmed',
          updated_at: CANDIDATE_UPDATED_AT,
          patient_name: '佐藤 花子',
          workflow_state: {
            review_state: 'reviewed',
            resolution_state: 'confirmed',
          },
        },
      ],
    });
  });

  it('defaults omitted billing_domain to home_care on read', async () => {
    billingCandidateFindManyMock.mockResolvedValueOnce([
      {
        id: 'candidate_1',
        patient_id: 'patient_1',
        status: 'confirmed',
        updated_at: new Date(CANDIDATE_UPDATED_AT),
        source_snapshot: null,
      },
    ]);
    patientFindManyMock.mockResolvedValueOnce([{ id: 'patient_1', name: '佐藤 花子' }]);

    const response = await GET(
      createGetRequest(
        'http://localhost/api/billing-candidates?billing_month=2026-03-01&patient_id=patient_1&limit=10',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(billingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
          patient_id: 'patient_1',
          billing_domain: 'home_care',
        }),
      }),
    );
    expect(workbenchSummaryMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        orgId: 'org_1',
        billingMonth: new Date('2026-03-01T00:00:00.000Z'),
        patientId: 'patient_1',
        billingDomain: 'home_care',
      }),
    );
  });

  it('normalizes malformed source snapshot metadata on read', async () => {
    billingCandidateFindManyMock.mockResolvedValueOnce([
      {
        id: 'candidate_malformed_snapshot',
        patient_id: 'patient_1',
        status: 'confirmed',
        source_snapshot: ['unexpected'],
      },
    ]);
    patientFindManyMock.mockResolvedValueOnce([{ id: 'patient_1', name: '佐藤 花子' }]);

    const response = await GET(
      createGetRequest('http://localhost/api/billing-candidates?billing_domain=pca_rental'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'candidate_malformed_snapshot',
          patient_name: '佐藤 花子',
          workflow_state: null,
          effective_revision_code: null,
          site_config_revision_code: null,
          site_config_status: null,
        },
      ],
    });
  });

  it('returns institution billing targets for PCA rental candidates without patient lookup', async () => {
    billingCandidateFindManyMock.mockResolvedValueOnce([
      {
        id: 'candidate_pca_rental',
        patient_id: null,
        billing_target_type: 'institution',
        billing_target_id: 'institution_1',
        billing_target_name: 'みなと病院',
        status: 'candidate',
        source_snapshot: {
          source_type: 'pca_pump_rental',
          source_entity_id: 'rental_private',
          source_note: 'PCAポンプレンタルの医療機関向け請求候補',
          billing_target: {
            type: 'institution',
            id: 'institution_1',
            name: 'みなと病院',
            institution_code: 'private_institution_code',
          },
          pca_rental: {
            rental_id: 'rental_private',
            pump_id: 'pump_private',
            pump_asset_code: 'asset_private',
            pump_model_name: 'CADD Legacy',
            pump_serial_number: 'serial_private',
            contact_name: '担当者A',
          },
          validation_layers: {
            evidence: {
              label: 'PCA貸出台帳',
              state: 'passed',
              message: '貸出期間と請求予定額を確認済み',
            },
          },
        },
      },
    ]);
    patientFindManyMock.mockResolvedValueOnce([]);

    const response = await GET(createGetRequest('http://localhost/api/billing-candidates'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          id: 'candidate_pca_rental',
          patient_id: null,
          patient_name: null,
          billing_target_type: 'institution',
          billing_target_id: 'institution_1',
          billing_target_label: 'みなと病院',
          source_snapshot: {
            source_type: 'pca_pump_rental',
            source_note: 'PCAポンプレンタルの医療機関向け請求候補',
            validation_layers: {
              evidence: {
                label: 'PCA貸出台帳',
              },
            },
          },
        },
      ],
    });
    expect(body.data[0].source_snapshot).not.toHaveProperty('billing_target');
    expect(body.data[0].source_snapshot).not.toHaveProperty('pca_rental');
    expect(body.data[0].source_snapshot).not.toHaveProperty('source_entity_id');
    expect(JSON.stringify(body.data[0])).not.toContain('serial_private');
    expect(JSON.stringify(body.data[0])).not.toContain('private_institution_code');
    expect(JSON.stringify(body.data[0])).not.toContain('担当者A');
  });

  it.each([
    ['empty query value', ''],
    ['incomplete month', '2026-03'],
    ['non-month-start date', '2026-03-02'],
    ['invalid calendar date', '2026-02-30'],
    ['out-of-range month', '2026-13-01'],
    ['timezone timestamp', '2026-03-01T00:00:00.000Z'],
  ])('rejects %s billing_month on read before org context', async (_caseName, billingMonth) => {
    const response = await GET(
      createGetRequest(
        `http://localhost/api/billing-candidates?billing_month=${encodeURIComponent(billingMonth)}`,
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(workbenchSummaryMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'billing_month duplicate',
      'billing_month=2026-03-01&billing_month=2026-04-01',
      {
        billing_month: ['billing_month は1つだけ指定してください'],
      },
    ],
    ['patient_id', 'patient_id=', { patient_id: ['患者IDを指定してください'] }],
    ['blank patient_id', 'patient_id=%20%20', { patient_id: ['患者IDを指定してください'] }],
    ['padded patient_id', 'patient_id=%20patient_1', { patient_id: ['患者IDの形式が不正です'] }],
    [
      'overlong patient_id',
      `patient_id=${'p'.repeat(101)}`,
      { patient_id: ['患者IDの形式が不正です'] },
    ],
    ['status', 'status=', { status: ['ステータスを指定してください'] }],
    ['blank status', 'status=%20%20', { status: ['ステータスを指定してください'] }],
    ['padded status', 'status=confirmed%20', { status: ['対応していないステータスです'] }],
    [
      'status duplicate',
      'status=confirmed&status=excluded',
      { status: ['status は1つだけ指定してください'] },
    ],
    [
      'billing_domain',
      'billing_domain=',
      { billing_domain: ['billing_domain を指定してください'] },
    ],
    [
      'blank billing_domain',
      'billing_domain=%20%20',
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
  ])('rejects malformed explicit %s on read before org context', async (_name, query, details) => {
    const response = await GET(
      createGetRequest(`http://localhost/api/billing-candidates?${query}`),
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
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(workbenchSummaryMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported status filters on read before org context', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/billing-candidates?status=voided'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '請求候補ステータスが不正です',
      details: {
        status: ['対応していないステータスです'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(workbenchSummaryMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported billing_domain filters on read before org context', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/billing-candidates?billing_domain=unknown'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'billing_domain は home_care または pca_rental を指定してください',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(workbenchSummaryMock).not.toHaveBeenCalled();
  });

  it('generates candidate summary using billing evidence service', async () => {
    const response = await POST(createRequest({ billing_month: '2026-03-01' }));

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expect(visitRecordFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        visit_date: {
          gte: new Date('2026-02-28T15:00:00.000Z'),
          lt: new Date('2026-03-31T15:00:00.000Z'),
        },
      },
      select: {
        id: true,
      },
    });
    expect(upsertBillingEvidenceForVisitMock).toHaveBeenCalledTimes(2);
    expect(generateBillingCandidatesForMonthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        billingCandidate: {
          findMany: billingCandidateFindManyMock,
        },
      }),
      {
        orgId: 'org_1',
        billingMonth: new Date('2026-03-01T00:00:00.000Z'),
      },
    );
    expect(generatePcaRentalBillingCandidatesForMonthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        billingCandidate: {
          findMany: billingCandidateFindManyMock,
        },
      }),
      {
        orgId: 'org_1',
        billingMonth: new Date('2026-03-01T00:00:00.000Z'),
      },
    );
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      billing_domain: 'all',
      generated: 4,
      home_care_generated: 3,
      pca_rental_generated: 1,
      confirmed: 1,
      review_required: 2,
      excluded: 1,
    });
  });

  it('generates only PCA rental candidates when billing_domain is pca_rental', async () => {
    const response = await POST(
      createRequest({ billing_month: '2026-06-01', billing_domain: 'pca_rental' }),
    );

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(upsertBillingEvidenceForVisitMock).not.toHaveBeenCalled();
    expect(generateBillingCandidatesForMonthMock).not.toHaveBeenCalled();
    expect(generatePcaRentalBillingCandidatesForMonthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        billingCandidate: {
          findMany: billingCandidateFindManyMock,
        },
      }),
      {
        orgId: 'org_1',
        billingMonth: new Date('2026-06-01T00:00:00.000Z'),
      },
    );
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      billing_domain: 'pca_rental',
      generated: 1,
      home_care_generated: 0,
      pca_rental_generated: 1,
    });
  });

  it('rejects invalid billing_domain on generation before database work', async () => {
    const response = await POST(
      createRequest({ billing_month: '2026-03-01', billing_domain: 'unknown' }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertBillingEvidenceForVisitMock).not.toHaveBeenCalled();
    expect(generateBillingCandidatesForMonthMock).not.toHaveBeenCalled();
    expect(generatePcaRentalBillingCandidatesForMonthMock).not.toHaveBeenCalled();
  });

  it.each([
    ['non-object root', ['unexpected']],
    ['missing', {}],
    ['empty', { billing_month: '' }],
    ['non-string', { billing_month: 123 }],
    ['incomplete month', { billing_month: '2026-03' }],
    ['non-month-start date', { billing_month: '2026-03-02' }],
    ['invalid calendar date', { billing_month: '2026-02-30' }],
    ['out-of-range month', { billing_month: '2026-13-01' }],
    ['timezone timestamp', { billing_month: '2026-03-01T00:00:00+09:00' }],
  ])('rejects %s billing_month on generation before database work', async (_caseName, body) => {
    const response = await POST(createRequest(body));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertBillingEvidenceForVisitMock).not.toHaveBeenCalled();
    expect(generateBillingCandidatesForMonthMock).not.toHaveBeenCalled();
    expect(generatePcaRentalBillingCandidatesForMonthMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on generation before database work', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertBillingEvidenceForVisitMock).not.toHaveBeenCalled();
    expect(generateBillingCandidatesForMonthMock).not.toHaveBeenCalled();
  });
});
