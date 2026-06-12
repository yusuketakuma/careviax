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

describe('/api/billing-candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitRecordFindManyMock.mockResolvedValue([{ id: 'visit_1' }, { id: 'visit_2' }]);
    billingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'candidate_1',
        patient_id: 'patient_1',
        status: 'confirmed',
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
          patient_name: '佐藤 花子',
          workflow_state: {
            review_state: 'reviewed',
            resolution_state: 'confirmed',
          },
        },
      ],
    });
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
          billing_target: {
            type: 'institution',
            id: 'institution_1',
            name: 'みなと病院',
          },
        },
      },
    ]);
    patientFindManyMock.mockResolvedValueOnce([]);

    const response = await GET(createGetRequest('http://localhost/api/billing-candidates'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'candidate_pca_rental',
          patient_id: null,
          patient_name: null,
          billing_target_type: 'institution',
          billing_target_id: 'institution_1',
          billing_target_label: 'みなと病院',
        },
      ],
    });
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
