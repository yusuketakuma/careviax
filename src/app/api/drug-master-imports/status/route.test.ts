import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  drugMasterImportLogFindManyMock,
  drugMasterCountMock,
  drugPackageInsertCountMock,
  drugInteractionCountMock,
  drugAlertRuleCountMock,
  genericDrugMappingCountMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  drugMasterImportLogFindManyMock: vi.fn(),
  drugMasterCountMock: vi.fn(),
  drugPackageInsertCountMock: vi.fn(),
  drugInteractionCountMock: vi.fn(),
  drugAlertRuleCountMock: vi.fn(),
  genericDrugMappingCountMock: vi.fn(),
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

import { GET } from './route';

function createRequest() {
  return {
    headers: { get: () => null },
    nextUrl: { pathname: '/api/drug-master-imports/status' },
    method: 'GET',
    url: 'http://localhost/api/drug-master-imports/status',
  } as unknown as NextRequest;
}

const SOURCES = ['ssk', 'mhlw_price', 'mhlw_generic', 'hot', 'pmda', 'manual_clinical'];

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
        }))
      )
      .mockResolvedValueOnce([]); // no failures

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.sources).toHaveLength(6);
    expect(body.sources.map((s: { source: string }) => s.source)).toEqual(SOURCES);
  });

  it('returns correct response structure with totals', async () => {
    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([]) // no successes
      .mockResolvedValueOnce([]); // no failures

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const body = await response.json();

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
  });

  it('marks source as fresh when days since import is within 50% of threshold', async () => {
    const now = new Date();
    // ssk threshold is 45 days; 10 days ago = 22% → fresh
    const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([
        { source: 'ssk', imported_at: recentDate, record_count: 50 },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest());
    const body = await response.json();

    const ssk = body.sources.find((s: { source: string }) => s.source === 'ssk');
    expect(ssk.freshness).toBe('fresh');
  });

  it('marks source as aging when days since import is between 50% and 100% of threshold', async () => {
    const now = new Date();
    // ssk threshold is 45 days; 30 days ago = 66% → aging
    const agingDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([
        { source: 'ssk', imported_at: agingDate, record_count: 50 },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest());
    const body = await response.json();

    const ssk = body.sources.find((s: { source: string }) => s.source === 'ssk');
    expect(ssk.freshness).toBe('aging');
  });

  it('marks source as stale when days since import exceeds threshold', async () => {
    const now = new Date();
    // ssk threshold is 45 days; 60 days ago → stale
    const staleDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([
        { source: 'ssk', imported_at: staleDate, record_count: 50 },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest());
    const body = await response.json();

    const ssk = body.sources.find((s: { source: string }) => s.source === 'ssk');
    expect(ssk.freshness).toBe('stale');
  });

  it('marks source as never when no successful import exists', async () => {
    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([]) // no successes
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest());
    const body = await response.json();

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
    const body = await response.json();

    const pmda = body.sources.find((s: { source: string }) => s.source === 'pmda');
    expect(pmda.last_failure).toMatchObject({
      imported_at: expect.any(String),
      error: 'Connection timeout after 30s',
    });
  });

  it('calculates hot_code_coverage as percentage of drugs with hot_code', async () => {
    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    // total = 1000, hot_code coverage count = 800
    drugMasterCountMock
      .mockResolvedValueOnce(1000)  // total
      .mockResolvedValueOnce(800);  // hot_code not null

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.totals.hot_code_coverage).toBe(80);
  });

  it('returns 0 hot_code_coverage when no drugs exist', async () => {
    drugMasterImportLogFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    drugMasterCountMock.mockResolvedValue(0);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.totals.hot_code_coverage).toBe(0);
  });

  it('returns 500 on database error', async () => {
    drugMasterImportLogFindManyMock.mockRejectedValue(new Error('DB connection lost'));

    await expect(GET(createRequest())).rejects.toThrow('DB connection lost');
  });
});
