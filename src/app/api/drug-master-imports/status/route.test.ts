import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  drugMasterImportLogFindManyMock,
  drugMasterCountMock,
  drugPackageInsertCountMock,
  drugInteractionCountMock,
  drugAlertRuleCountMock,
  genericDrugMappingCountMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  drugMasterImportLogFindManyMock: vi.fn(),
  drugMasterCountMock: vi.fn(),
  drugPackageInsertCountMock: vi.fn(),
  drugInteractionCountMock: vi.fn(),
  drugAlertRuleCountMock: vi.fn(),
  genericDrugMappingCountMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    drugMasterImportLog: {
      findMany: drugMasterImportLogFindManyMock,
    },
    drugMaster: {
      count: drugMasterCountMock,
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
import { GET } from './route';

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

  expect(payload).toMatchObject({
    sources: expect.any(Array),
    totals: {
      drug_master_count: expect.any(Number),
      hot_code_coverage: expect.any(Number),
      package_insert_count: expect.any(Number),
      interaction_count: expect.any(Number),
      active_alert_rule_count: expect.any(Number),
      generic_mapping_count: expect.any(Number),
    },
    checked_at: expect.any(String),
  });

  return payload as DrugMasterImportStatusResponse;
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function findStatusSource(
  body: DrugMasterImportStatusResponse,
  source: DrugMasterImportSourceStatus['source'],
) {
  const status = body.sources.find((item) => item.source === source);
  if (!status) throw new Error(`missing status source: ${source}`);
  return status;
}

describe('GET /api/drug-master-imports/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { userId: 'user_1', orgId: 'org_1', role: 'admin' },
    });
    drugMasterImportLogFindManyMock.mockResolvedValue([]);
    drugMasterCountMock.mockResolvedValue(1000);
    drugPackageInsertCountMock.mockResolvedValue(500);
    drugInteractionCountMock.mockResolvedValue(200);
    drugAlertRuleCountMock.mockResolvedValue(50);
    genericDrugMappingCountMock.mockResolvedValue(300);
  });

  it('returns 401 when not authenticated', async () => {
    requireAuthContextMock.mockResolvedValue({
      response: new Response(JSON.stringify({ code: 'AUTH_UNAUTHENTICATED' }), { status: 401 }),
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(drugMasterImportLogFindManyMock).not.toHaveBeenCalled();
    expect(drugMasterCountMock).not.toHaveBeenCalled();
  });

  it('returns 403 before querying import status when admin permission is denied', async () => {
    requireAuthContextMock.mockResolvedValue({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(drugMasterImportLogFindManyMock).not.toHaveBeenCalled();
    expect(drugMasterCountMock).not.toHaveBeenCalled();
    expect(drugPackageInsertCountMock).not.toHaveBeenCalled();
    expect(drugInteractionCountMock).not.toHaveBeenCalled();
    expect(drugAlertRuleCountMock).not.toHaveBeenCalled();
    expect(genericDrugMappingCountMock).not.toHaveBeenCalled();
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
        })),
      )
      .mockResolvedValueOnce([]); // no failures

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canAdmin',
      message: '医薬品マスター取込状態の閲覧権限がありません',
    });
    const body = await readStatusPayload(response);

    expect(body.sources).toHaveLength(6);
    expect(body.sources.map((source) => source.source)).toEqual(SOURCES);
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

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([]) // no successes
      .mockResolvedValueOnce([
        {
          source: 'pmda',
          imported_at: failDate,
          error_log: 'Connection timeout after 30s',
        },
      ]);

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    const pmda = findStatusSource(body, 'pmda');
    expect(pmda.last_failure).toMatchObject({
      imported_at: expect.any(String),
      error: 'Connection timeout after 30s',
    });
  });

  it('summarizes recent run volume and failure streak by source', async () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { source: 'pmda', imported_at: recentDate, status: 'failed' },
        { source: 'pmda', imported_at: recentDate, status: 'failed' },
        { source: 'ssk', imported_at: recentDate, status: 'completed' },
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
      total: 1,
      failed: 0,
      failure_streak: 0,
      latest_status: 'completed',
    });
  });

  it('calculates hot_code_coverage as percentage of drugs with hot_code', async () => {
    drugMasterImportLogFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    // total = 1000, hot_code coverage count = 800
    drugMasterCountMock
      .mockResolvedValueOnce(1000) // total
      .mockResolvedValueOnce(800); // hot_code not null

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    expect(body.totals.hot_code_coverage).toBe(80);
  });

  it('returns 0 hot_code_coverage when no drugs exist', async () => {
    drugMasterImportLogFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    drugMasterCountMock.mockResolvedValue(0);

    const response = await GET(createRequest());
    const body = await readStatusPayload(response);

    expect(body.totals.hot_code_coverage).toBe(0);
  });

  it('returns a sanitized no-store 500 on database error', async () => {
    const unsafeError = new Error('DB connection lost with raw import status secret');
    unsafeError.name = 'DrugImportStatusSecretError';
    drugMasterImportLogFindManyMock.mockRejectedValue(unsafeError);

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('import status secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'drug_master_imports_status_get_unhandled_error',
      undefined,
      {
        event: 'drug_master_imports_status_get_unhandled_error',
        route: '/api/drug-master-imports/status',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('import status secret');
    expect(logged).not.toContain('DrugImportStatusSecretError');
  });
});
