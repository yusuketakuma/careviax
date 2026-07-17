import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  drugMasterImportLogFindManyMock,
  drugMasterCountMock,
  drugPackageCountMock,
  drugPackageInsertCountMock,
  drugInteractionCountMock,
  drugAlertRuleCountMock,
  genericDrugMappingCountMock,
  loggerErrorMock,
  runWithRequestAuthContextMock,
  unstableRethrowMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  drugMasterImportLogFindManyMock: vi.fn(),
  drugMasterCountMock: vi.fn(),
  drugPackageCountMock: vi.fn(),
  drugPackageInsertCountMock: vi.fn(),
  drugInteractionCountMock: vi.fn(),
  drugAlertRuleCountMock: vi.fn(),
  genericDrugMappingCountMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  unstableRethrowMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  clearRequestAuthContext: vi.fn(),
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    drugMasterImportLog: {
      findMany: drugMasterImportLogFindManyMock,
    },
    drugMaster: {
      count: drugMasterCountMock,
    },
    drugPackage: {
      count: drugPackageCountMock,
    },
    drugPackageInsert: {
      count: drugPackageInsertCountMock,
    },
    drugInteraction: {
      count: drugInteractionCountMock,
    },
    drugAlertRule: {
      count: drugAlertRuleCountMock,
    },
    genericDrugMapping: {
      count: genericDrugMappingCountMock,
    },
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import type { DrugMasterImportStatusResponse } from '@/types/drug-master-import-status';
import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

type DrugMasterImportSourceStatus = DrugMasterImportStatusResponse['sources'][number];

function createRequest() {
  return new NextRequest('http://localhost/api/drug-master-imports/status', {
    headers: { 'x-org-id': 'org_1' },
  });
}

const SOURCES = [
  'ssk',
  'mhlw_price',
  'mhlw_generic',
  'hot',
  'pmda',
  'manual_clinical',
] satisfies DrugMasterImportSourceStatus['source'][];

async function readStatusPayload(response: Response): Promise<DrugMasterImportStatusResponse> {
  expectNoStore(response);
  const payload: unknown = await response.json();

  expect(Object.keys(payload as Record<string, unknown>)).toEqual(['data']);
  expect(payload).toMatchObject({
    data: {
      sources: expect.any(Array),
      totals: {
        drug_master_count: expect.any(Number),
        drug_package_count: expect.any(Number),
        drug_package_coverage: expect.any(Number),
        hot_code_coverage: expect.any(Number),
        package_insert_count: expect.any(Number),
        interaction_count: expect.any(Number),
        active_alert_rule_count: expect.any(Number),
        generic_mapping_count: expect.any(Number),
      },
      checked_at: expect.any(String),
    },
  });

  return (payload as { data: DrugMasterImportStatusResponse }).data;
}

function findStatusSource(
  body: DrugMasterImportStatusResponse,
  source: DrugMasterImportSourceStatus['source'],
) {
  const status = body.sources.find((item) => item.source === source);
  if (!status) throw new Error(`missing status source: ${source}`);
  return status;
}

function expectNoStatusQueries() {
  expect(drugMasterImportLogFindManyMock).not.toHaveBeenCalled();
  expect(drugMasterCountMock).not.toHaveBeenCalled();
  expect(drugPackageCountMock).not.toHaveBeenCalled();
  expect(drugPackageInsertCountMock).not.toHaveBeenCalled();
  expect(drugInteractionCountMock).not.toHaveBeenCalled();
  expect(drugAlertRuleCountMock).not.toHaveBeenCalled();
  expect(genericDrugMappingCountMock).not.toHaveBeenCalled();
}

describe('GET /api/drug-master-imports/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    drugMasterImportLogFindManyMock.mockResolvedValue([]);
    drugMasterCountMock.mockResolvedValue(1000);
    drugPackageCountMock.mockResolvedValue(1200);
    drugPackageInsertCountMock.mockResolvedValue(500);
    drugInteractionCountMock.mockResolvedValue(200);
    drugAlertRuleCountMock.mockResolvedValue(50);
    genericDrugMappingCountMock.mockResolvedValue(300);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    expectNoStore(response);
    expectNoStatusQueries();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
  });

  it('returns 403 before querying import status when admin permission is denied', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'pharmacist', site_id: null });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expectNoStore(response);
    expectNoStatusQueries();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '医薬品マスター取込状態の閲覧権限がありません',
    });
  });

  it('returns a generated-trace safe 500 before status queries when auth dependencies throw', async () => {
    const unsafeError = new Error('raw drug status auth secret');
    unsafeError.name = 'DrugStatusAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest());
    const requestId = response.headers.get('X-Request-Id');
    const correlationId = response.headers.get('X-Correlation-Id');

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(requestId).toBeTruthy();
    expect(correlationId).toBeTruthy();
    expectNoStatusQueries();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toMatch(
      /raw drug status auth secret|DrugStatusAuthSecretError/,
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-master-imports/status',
        method: 'GET',
        requestId,
        correlationId,
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toMatch(
      /raw drug status auth secret|DrugStatusAuthSecretError/,
    );
  });

  it('returns freshness data for all import sources', async () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce(
        SOURCES.map((source) => ({
          source,
          imported_at: recentDate,
          record_count: 100,
          source_file_hash: source === 'ssk' ? 'ssk_source_hash' : null,
          source_published_at: source === 'ssk' ? new Date('2026-06-11T00:00:00.000Z') : null,
          import_mode: source === 'ssk' ? 'full' : null,
          change_summary:
            source === 'ssk'
              ? {
                  mode: 'full',
                  parsed_records: 100,
                  imported_records: 100,
                }
              : null,
        })),
      )
      .mockResolvedValueOnce([]); // no failures

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const body = await readStatusPayload(response);
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();

    expect(body.sources).toHaveLength(6);
    expect(body.sources.map((source) => source.source)).toEqual(SOURCES);
    expect(
      body.sources.map(({ source, label, is_free, threshold_days }) => ({
        source,
        label,
        is_free,
        threshold_days,
      })),
    ).toEqual([
      { source: 'ssk', label: 'SSK基本マスター', is_free: true, threshold_days: 45 },
      {
        source: 'mhlw_price',
        label: '厚労省 薬価基準収載品目リスト',
        is_free: true,
        threshold_days: 120,
      },
      {
        source: 'mhlw_generic',
        label: '厚労省 一般名処方マスタ',
        is_free: true,
        threshold_days: 120,
      },
      {
        source: 'hot',
        label: 'MEDIS HOTコードマスター',
        is_free: false,
        threshold_days: 60,
      },
      { source: 'pmda', label: 'PMDA 添付文書', is_free: false, threshold_days: 14 },
      {
        source: 'manual_clinical',
        label: '手動臨床ルール',
        is_free: false,
        threshold_days: 365,
      },
    ]);
    const ssk = findStatusSource(body, 'ssk');
    expect(ssk.last_success).toMatchObject({
      source_file_hash: 'ssk_source_hash',
      source_published_at: '2026-06-11T00:00:00.000Z',
      import_mode: 'full',
      change_summary: {
        mode: 'full',
        parsed_records: 100,
        imported_records: 100,
      },
    });
    expect(drugMasterImportLogFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        select: expect.objectContaining({
          source_file_hash: true,
          source_published_at: true,
          import_mode: true,
          change_summary: true,
        }),
      }),
    );
  });

  it('returns correct response structure with totals', async () => {
    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([]) // no successes
      .mockResolvedValueOnce([]); // no failures

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const body = await readStatusPayload(response);

    expect(body).toMatchObject({
      sources: expect.any(Array),
      totals: {
        drug_master_count: 1000,
        drug_package_count: 1200,
        drug_package_coverage: 100,
        hot_code_coverage: expect.any(Number),
        package_insert_count: 500,
        interaction_count: 200,
        active_alert_rule_count: 50,
        generic_mapping_count: 300,
      },
      checked_at: expect.any(String),
    });
    expect(drugAlertRuleCountMock).toHaveBeenCalledWith({
      where: { is_active: true, org_id: null },
    });
    expect(drugMasterCountMock).toHaveBeenCalledWith({
      where: { drug_packages: { some: { is_active: true } } },
    });
  });

  it('marks source as fresh when days since import is within 50% of threshold', async () => {
    const now = new Date();
    // ssk threshold is 45 days; 10 days ago = 22% → fresh
    const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([{ source: 'ssk', imported_at: recentDate, record_count: 50 }])
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    const ssk = findStatusSource(body, 'ssk');
    expect(ssk.freshness).toBe('fresh');
  });

  it('marks source as aging when days since import is between 50% and 100% of threshold', async () => {
    const now = new Date();
    // ssk threshold is 45 days; 30 days ago = 66% → aging
    const agingDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([{ source: 'ssk', imported_at: agingDate, record_count: 50 }])
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    const ssk = findStatusSource(body, 'ssk');
    expect(ssk.freshness).toBe('aging');
  });

  it('marks source as stale when days since import exceeds threshold', async () => {
    const now = new Date();
    // ssk threshold is 45 days; 60 days ago → stale
    const staleDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([{ source: 'ssk', imported_at: staleDate, record_count: 50 }])
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    const ssk = findStatusSource(body, 'ssk');
    expect(ssk.freshness).toBe('stale');
  });

  it('preserves the integer-day freshness boundaries for the SSK threshold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
    try {
      for (const [daysAgo, expected] of [
        [22, 'fresh'],
        [23, 'aging'],
        [45, 'aging'],
        [46, 'stale'],
      ] as const) {
        drugMasterImportLogFindManyMock
          .mockResolvedValueOnce([
            {
              source: 'ssk',
              imported_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
              record_count: 50,
            },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

        const response = await GET(createRequest());
        const body = await readStatusPayload(response);
        expect(findStatusSource(body, 'ssk').freshness).toBe(expected);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks source as never when no successful import exists', async () => {
    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([]) // no successes
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    for (const src of body.sources) {
      expect(src.freshness).toBe('never');
      expect(src.last_success).toBeNull();
    }
  });

  it('includes last_failure info when a failed import exists', async () => {
    const now = new Date();
    const failDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const exposedPrefix = 'x'.repeat(200);
    const hiddenSentinel = 'HIDDEN_SECRET_SENTINEL';

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([]) // no successes
      .mockResolvedValueOnce([
        {
          source: 'pmda',
          imported_at: failDate,
          error_log: `${exposedPrefix}${hiddenSentinel}`,
        },
      ]);

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    const pmda = findStatusSource(body, 'pmda');
    expect(pmda.last_failure).toMatchObject({
      imported_at: expect.any(String),
      error: exposedPrefix,
    });
    expect(JSON.stringify(pmda.last_failure)).not.toContain(hiddenSentinel);
  });

  it('summarizes recent run volume and failure streak by source', async () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { source: 'ssk', imported_at: recentDate, status: 'completed' },
        { source: 'ssk', imported_at: recentDate, status: 'failed' },
        { source: 'pmda', imported_at: recentDate, status: 'failed' },
        { source: 'pmda', imported_at: recentDate, status: 'failed' },
      ]);

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    const pmda = findStatusSource(body, 'pmda');
    expect(pmda.recent_runs_30d).toMatchObject({
      total: 2,
      failed: 2,
      failure_streak: 2,
      latest_status: 'failed',
      latest_imported_at: expect.any(String),
    });

    const ssk = findStatusSource(body, 'ssk');
    expect(ssk.recent_runs_30d).toMatchObject({
      total: 2,
      failed: 1,
      failure_streak: 0,
      latest_status: 'completed',
    });
    expect(drugMasterImportLogFindManyMock).toHaveBeenNthCalledWith(3, {
      where: { imported_at: { gte: expect.any(Date) } },
      orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
      take: 300,
      select: { source: true, imported_at: true, status: true },
    });
  });

  it('starts all eleven aggregate reads before awaiting their results', async () => {
    let releaseBarrier: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    drugMasterImportLogFindManyMock.mockImplementation(() => barrier.then(() => []));
    drugMasterCountMock.mockImplementation(() => barrier.then(() => 1000));
    drugPackageCountMock.mockImplementation(() => barrier.then(() => 1200));
    drugPackageInsertCountMock.mockImplementation(() => barrier.then(() => 500));
    drugInteractionCountMock.mockImplementation(() => barrier.then(() => 200));
    drugAlertRuleCountMock.mockImplementation(() => barrier.then(() => 50));
    genericDrugMappingCountMock.mockImplementation(() => barrier.then(() => 300));

    const responsePromise = GET(createRequest());

    await vi.waitFor(() => {
      expect(drugMasterImportLogFindManyMock).toHaveBeenCalledTimes(3);
      expect(drugMasterCountMock).toHaveBeenCalledTimes(3);
      expect(drugPackageCountMock).toHaveBeenCalledOnce();
      expect(drugPackageInsertCountMock).toHaveBeenCalledOnce();
      expect(drugInteractionCountMock).toHaveBeenCalledOnce();
      expect(drugAlertRuleCountMock).toHaveBeenCalledOnce();
      expect(genericDrugMappingCountMock).toHaveBeenCalledOnce();
    });
    releaseBarrier?.();

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expectNoStore(response);
  });

  it('calculates drug package and hot code coverage as percentages of DrugMaster rows', async () => {
    drugMasterImportLogFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    // total = 1000, active DrugPackage-linked DrugMaster count = 250, hot_code count = 800
    drugMasterCountMock
      .mockResolvedValueOnce(1000) // total
      .mockResolvedValueOnce(250) // active package-linked DrugMaster rows
      .mockResolvedValueOnce(800); // hot_code not null

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    expect(body.totals.drug_package_coverage).toBe(25);
    expect(body.totals.hot_code_coverage).toBe(80);
  });

  it('returns 0 hot_code_coverage when no drugs exist', async () => {
    drugMasterImportLogFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    drugMasterCountMock.mockResolvedValue(0);

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    expect(body.totals.hot_code_coverage).toBe(0);
    expect(body.totals.drug_package_coverage).toBe(0);
  });

  it('returns a sanitized no-store 500 on database error', async () => {
    const unsafeError = new Error(
      'DB connection lost with raw import status secret source_url=https://example.invalid/import.csv?token=secret error_log=raw status stack',
    );
    unsafeError.name = 'DrugImportStatusSecretError';
    drugMasterImportLogFindManyMock.mockRejectedValue(unsafeError);

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('import status secret');
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-master-imports/status',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
    expect(loggerErrorMock.mock.calls[0]?.[0]).not.toHaveProperty('error_name');
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('import status secret');
    expect(loggedContext).not.toContain('DrugImportStatusSecretError');
    expect(loggedContext).not.toContain('source_url');
    expect(loggedContext).not.toContain('error_log');
    expect(loggedContext).not.toContain('https://example.invalid');
    expect(loggedContext).not.toContain('raw status stack');
  });

  it('rethrows auth and handler control flow without logging', async () => {
    const authControl = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(authControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(GET(createRequest())).rejects.toBe(authControl);
    expectNoStatusQueries();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin', site_id: null });
    const handlerControl = new Error('NEXT_NOT_FOUND');
    drugMasterImportLogFindManyMock.mockRejectedValueOnce(handlerControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(GET(createRequest())).rejects.toBe(handlerControl);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
