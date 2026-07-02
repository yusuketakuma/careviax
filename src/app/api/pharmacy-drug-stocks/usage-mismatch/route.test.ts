import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, loggerErrorMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  prismaMock: {
    auditLog: { create: vi.fn() },
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    qrScanDraft: { findMany: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn() },
    drugMaster: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));
vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));
vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET } from './route';

function createRequest(
  url = 'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1',
) {
  return new NextRequest(url, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/pharmacy-drug-stocks/usage-mismatch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    withOrgContextMock.mockImplementation((_orgId, callback) =>
      callback({
        pharmacySite: prismaMock.pharmacySite,
        qrScanDraft: prismaMock.qrScanDraft,
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        drugMaster: prismaMock.drugMaster,
      }),
    );
    prismaMock.qrScanDraft.findMany.mockResolvedValue([
      {
        id: 'draft_1',
        created_at: new Date('2026-05-26T00:00:00.000Z'),
        parsed_data: {
          medications: [
            { drugCode: '111111111111', drugName: '頻出未採用薬' },
            { drugCode: '222222222222', drugName: '採用済み薬' },
          ],
        },
      },
      {
        id: 'draft_2',
        created_at: new Date('2026-05-25T00:00:00.000Z'),
        parsed_data: {
          medications: [{ drugCode: '111111111111', drugName: '頻出未採用薬' }],
        },
      },
    ]);
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        id: 'stock_used',
        drug_master_id: 'drug_stocked',
        reorder_point: 5,
        updated_at: new Date('2026-05-20T00:00:00.000Z'),
        drug_master: {
          id: 'drug_stocked',
          yj_code: '222222222222',
          drug_name: '採用済み薬',
          generic_name: null,
          drug_price: 20,
          unit: '錠',
          is_generic: false,
        },
      },
      {
        id: 'stock_unused',
        drug_master_id: 'drug_unused',
        reorder_point: 10,
        updated_at: new Date('2026-05-21T00:00:00.000Z'),
        drug_master: {
          id: 'drug_unused',
          yj_code: '333333333333',
          drug_name: '未使用採用品',
          generic_name: null,
          drug_price: 30,
          unit: '錠',
          is_generic: false,
        },
      },
    ]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_unstocked',
        yj_code: '111111111111',
        drug_name: '頻出未採用薬',
        generic_name: null,
        drug_price: 10,
        unit: '錠',
        is_generic: true,
      },
      {
        id: 'drug_stocked',
        yj_code: '222222222222',
        drug_name: '採用済み薬',
        generic_name: null,
        drug_price: 20,
        unit: '錠',
        is_generic: false,
      },
    ]);
  });

  it('reports frequent QR-prescribed unstocked drugs and stocked drugs unused in recent QR drafts', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=%202%20&limit=%201%20',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      site: { id: 'site_1' },
      totals: {
        scanned_draft_count: 2,
        used_drug_count: 2,
        medication_line_count: 3,
        matched_drug_count: 2,
        unmatched_drug_count: 0,
        stocked_count: 2,
        frequent_unstocked_count: 1,
        unused_stocked_count: 1,
        possibly_used_stocked_count: 0,
        displayed_frequent_unstocked_count: 1,
        displayed_unused_stocked_count: 1,
        displayed_possibly_used_stocked_count: 0,
      },
      list_counts: {
        frequent_unstocked: expect.objectContaining({
          total_count: 1,
          visible_count: 1,
          hidden_count: 0,
          truncated: false,
        }),
        unused_stocked: expect.objectContaining({
          total_count: 1,
          visible_count: 1,
          hidden_count: 0,
          truncated: false,
        }),
        unmatched_prescribed: expect.objectContaining({
          total_count: 0,
          visible_count: 0,
          hidden_count: 0,
          truncated: false,
        }),
      },
      frequent_unstocked: [
        {
          drug_code: '111111111111',
          drug_name: '頻出未採用薬',
          count: 2,
          matched_drug: { id: 'drug_unstocked' },
        },
      ],
      unused_stocked: [{ id: 'stock_unused', drug_master_id: 'drug_unused' }],
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    expect(prismaMock.qrScanDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          status: { not: 'discarded' },
        }),
        take: 500,
      }),
    );
  });

  it('rejects malformed numeric query values before reading QR drafts', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&days=9e1&draft_limit=10.0',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.qrScanDraft.findMany).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
  });

  it('returns no-store auth failure before reading query-scoped pharmacy data', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(prismaMock.membership.findFirst).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.qrScanDraft.findMany).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'security:auth_failure',
        }),
      }),
    );
  });

  it('ignores non-object medication entries in QR parsed_data', async () => {
    prismaMock.qrScanDraft.findMany.mockResolvedValue([
      {
        id: 'draft_malformed',
        created_at: new Date('2026-05-26T00:00:00.000Z'),
        parsed_data: {
          medications: [
            ['unexpected'],
            'unexpected',
            null,
            { drugCode: '111111111111', drugName: '頻出未採用薬' },
          ],
        },
      },
    ]);
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totals: {
        scanned_draft_count: 1,
        used_drug_count: 1,
        medication_line_count: 1,
        matched_drug_count: 1,
        unmatched_drug_count: 0,
        frequent_unstocked_count: 1,
      },
      frequent_unstocked: [
        {
          drug_code: '111111111111',
          drug_name: '頻出未採用薬',
          count: 1,
          matched_drug: { id: 'drug_unstocked' },
        },
      ],
    });
  });

  it('returns a sanitized no-store 500 when usage mismatch lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw usage mismatch medication secret');
    unsafeError.name = 'UsageMismatchSecretError';
    prismaMock.qrScanDraft.findMany.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('medication secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'pharmacy_drug_stocks_usage_mismatch_get_unhandled_error',
        route: '/api/pharmacy-drug-stocks/usage-mismatch',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('medication secret');
    expect(logged).not.toContain('UsageMismatchSecretError');
  });

  it('keeps name-only QR medication rows unresolved instead of matching DrugMaster by name', async () => {
    prismaMock.qrScanDraft.findMany.mockResolvedValue([
      {
        id: 'draft_name_only',
        created_at: new Date('2026-05-26T00:00:00.000Z'),
        parsed_data: {
          medications: [{ drugName: '採用済み薬' }],
        },
      },
    ]);
    prismaMock.drugMaster.findMany.mockResolvedValue([]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totals: {
        used_drug_count: 1,
        medication_line_count: 1,
        matched_drug_count: 0,
        unmatched_drug_count: 1,
        frequent_unstocked_count: 1,
        unused_stocked_count: 2,
      },
      frequent_unstocked: [
        {
          drug_code: null,
          drug_name: '採用済み薬',
          matched_drug: null,
        },
      ],
      unmatched_prescribed: [
        {
          drug_code: null,
          drug_name: '採用済み薬',
          count: 1,
        },
      ],
    });
    expect(prismaMock.drugMaster.findMany).not.toHaveBeenCalled();
  });

  it('keeps name-only and code-resolved medication rows separate when they share the same text', async () => {
    prismaMock.qrScanDraft.findMany.mockResolvedValue([
      {
        id: 'draft_code_and_name',
        created_at: new Date('2026-05-26T00:00:00.000Z'),
        parsed_data: {
          medications: [{ drugCode: '2149001', drugName: '解決済み薬' }, { drugName: '2149001' }],
        },
      },
    ]);
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_code_resolved',
        yj_code: '2149001',
        drug_name: '解決済み薬',
        generic_name: null,
        drug_price: 10,
        unit: '錠',
        is_generic: false,
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totals: {
        used_drug_count: 2,
        medication_line_count: 2,
        matched_drug_count: 1,
        unmatched_drug_count: 1,
        frequent_unstocked_count: 2,
      },
      frequent_unstocked: expect.arrayContaining([
        expect.objectContaining({
          drug_code: '2149001',
          drug_name: '解決済み薬',
          matched_drug: expect.objectContaining({ id: 'drug_code_resolved' }),
        }),
        expect.objectContaining({
          drug_code: null,
          drug_name: '2149001',
          matched_drug: null,
        }),
      ]),
      unmatched_prescribed: [
        {
          drug_code: null,
          drug_name: '2149001',
          count: 1,
        },
      ],
    });
    expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { yj_code: { in: ['2149001'] } },
            { receipt_code: { in: ['2149001'] } },
            { hot_code: { in: ['2149001'] } },
          ],
        },
      }),
    );
  });

  it('resolves QR usage by receipt and HOT codes without truncating to YJ length', async () => {
    prismaMock.qrScanDraft.findMany.mockResolvedValue([
      {
        id: 'draft_receipt_hot',
        created_at: new Date('2026-05-26T00:00:00.000Z'),
        parsed_data: {
          medications: [
            { drugCode: '123456789', drugName: 'レセ電コード薬' },
            { drugCode: '1234567890123', drugName: 'HOTコード薬' },
          ],
        },
      },
    ]);
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_receipt',
        yj_code: '111111111111',
        receipt_code: '123456789',
        hot_code: null,
        drug_name: 'レセ電コード薬',
        generic_name: null,
        drug_price: 10,
        unit: '錠',
        is_generic: false,
      },
      {
        id: 'drug_hot',
        yj_code: '222222222222',
        receipt_code: null,
        hot_code: '1234567890123',
        drug_name: 'HOTコード薬',
        generic_name: null,
        drug_price: 20,
        unit: '錠',
        is_generic: false,
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      totals: {
        used_drug_count: 2,
        medication_line_count: 2,
        matched_drug_count: 2,
        unmatched_drug_count: 0,
        frequent_unstocked_count: 2,
      },
      frequent_unstocked: expect.arrayContaining([
        expect.objectContaining({
          drug_code: '123456789',
          drug_name: 'レセ電コード薬',
          matched_drug: expect.objectContaining({ id: 'drug_receipt', yj_code: '111111111111' }),
        }),
        expect.objectContaining({
          drug_code: '1234567890123',
          drug_name: 'HOTコード薬',
          matched_drug: expect.objectContaining({ id: 'drug_hot', yj_code: '222222222222' }),
        }),
      ]),
      unmatched_prescribed: [],
    });
    for (const row of body.frequent_unstocked) {
      expect(row.matched_drug).not.toHaveProperty('receipt_code');
      expect(row.matched_drug).not.toHaveProperty('hot_code');
    }
    expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { yj_code: { in: ['123456789', '1234567890123'] } },
            { receipt_code: { in: ['123456789', '1234567890123'] } },
            { hot_code: { in: ['123456789', '1234567890123'] } },
          ],
        },
      }),
    );
  });

  it('keeps ambiguous receipt and HOT overlaps unresolved while preserving YJ priority', async () => {
    prismaMock.qrScanDraft.findMany.mockResolvedValue([
      {
        id: 'draft_overlapping_codes',
        created_at: new Date('2026-05-26T00:00:00.000Z'),
        parsed_data: {
          medications: [
            { drugCode: '123456789012', drugName: 'YJ優先薬' },
            { drugCode: '987654321', drugName: 'レセ電優先薬' },
          ],
        },
      },
    ]);
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        id: 'stock_ambiguous_candidate',
        drug_master_id: 'drug_receipt_for_receipt_code',
        reorder_point: 5,
        updated_at: new Date('2026-05-21T00:00:00.000Z'),
        drug_master: {
          id: 'drug_receipt_for_receipt_code',
          yj_code: '000000000004',
          drug_name: 'レセ電優先薬',
          generic_name: null,
          drug_price: 50,
          unit: '錠',
          is_generic: false,
        },
      },
    ]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_hot_first',
        yj_code: '000000000001',
        receipt_code: null,
        hot_code: '123456789012',
        drug_name: 'HOT一致薬',
        generic_name: null,
        drug_price: 10,
        unit: '錠',
        is_generic: false,
      },
      {
        id: 'drug_receipt_second',
        yj_code: '000000000002',
        receipt_code: '123456789012',
        hot_code: null,
        drug_name: 'レセ電一致薬',
        generic_name: null,
        drug_price: 20,
        unit: '錠',
        is_generic: false,
      },
      {
        id: 'drug_yj_last',
        yj_code: '123456789012',
        receipt_code: null,
        hot_code: null,
        drug_name: 'YJ優先薬',
        generic_name: null,
        drug_price: 30,
        unit: '錠',
        is_generic: false,
      },
      {
        id: 'drug_hot_for_receipt_code',
        yj_code: '000000000003',
        receipt_code: null,
        hot_code: '987654321',
        drug_name: 'HOT9桁一致薬',
        generic_name: null,
        drug_price: 40,
        unit: '錠',
        is_generic: false,
      },
      {
        id: 'drug_receipt_for_receipt_code',
        yj_code: '000000000004',
        receipt_code: '987654321',
        hot_code: null,
        drug_name: 'レセ電優先薬',
        generic_name: null,
        drug_price: 50,
        unit: '錠',
        is_generic: false,
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      totals: {
        matched_drug_count: 1,
        unmatched_drug_count: 1,
        frequent_unstocked_count: 2,
        unused_stocked_count: 0,
        possibly_used_stocked_count: 1,
      },
      frequent_unstocked: expect.arrayContaining([
        expect.objectContaining({
          drug_code: '123456789012',
          matched_drug: expect.objectContaining({ id: 'drug_yj_last' }),
          resolution_status: 'resolved',
          source_code_system: 'yj',
        }),
        expect.objectContaining({
          drug_code: '987654321',
          matched_drug: null,
          mismatch_kind: 'resolver_review_required',
          resolution_status: 'ambiguous_code',
          source_code_system: null,
          candidate_code_systems: ['receipt', 'hot'],
          candidate_count: 2,
        }),
      ]),
      unmatched_prescribed: [
        expect.objectContaining({
          drug_code: '987654321',
          mismatch_kind: 'resolver_review_required',
          resolution_status: 'ambiguous_code',
          source_code_system: null,
          candidate_code_systems: ['receipt', 'hot'],
          candidate_count: 2,
        }),
      ],
      unused_stocked: [],
      possibly_used_stocked: [
        expect.objectContaining({
          id: 'stock_ambiguous_candidate',
          drug_master_id: 'drug_receipt_for_receipt_code',
          usage_status: 'unknown_due_to_ambiguous_code',
        }),
      ],
    });
  });

  it('reports stable code-system metadata for cross-family ambiguous matches regardless of master order', async () => {
    const hotCandidate = {
      id: 'drug_hot_candidate',
      yj_code: '000000000003',
      receipt_code: null,
      hot_code: '987654321',
      drug_name: 'HOT9桁一致薬',
      generic_name: null,
      drug_price: 40,
      unit: '錠',
      is_generic: false,
    };
    const receiptCandidate = {
      id: 'drug_receipt_candidate',
      yj_code: '000000000004',
      receipt_code: '987654321',
      hot_code: null,
      drug_name: 'レセ電一致薬',
      generic_name: null,
      drug_price: 50,
      unit: '錠',
      is_generic: false,
    };

    const readAmbiguousRow = async (
      masters: Array<typeof hotCandidate | typeof receiptCandidate>,
    ) => {
      prismaMock.qrScanDraft.findMany.mockResolvedValue([
        {
          id: 'draft_cross_family',
          created_at: new Date('2026-05-26T00:00:00.000Z'),
          parsed_data: {
            medications: [{ drugCode: '987654321', drugName: '曖昧コード薬' }],
          },
        },
      ]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
      prismaMock.drugMaster.findMany.mockResolvedValue(masters);

      const response = await GET(
        createRequest(
          'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=1',
        ),
        { params: Promise.resolve({}) },
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      const body = await response.json();
      return body.frequent_unstocked.find(
        (row: { drug_code: string | null }) => row.drug_code === '987654321',
      );
    };

    await expect(readAmbiguousRow([hotCandidate, receiptCandidate])).resolves.toMatchObject({
      resolution_status: 'ambiguous_code',
      source_code_system: null,
      candidate_code_systems: ['receipt', 'hot'],
      candidate_count: 2,
    });
    await expect(readAmbiguousRow([receiptCandidate, hotCandidate])).resolves.toMatchObject({
      resolution_status: 'ambiguous_code',
      source_code_system: null,
      candidate_code_systems: ['receipt', 'hot'],
      candidate_count: 2,
    });
  });

  it('keeps duplicate receipt-code matches unresolved and excludes stocked candidates from cleanup', async () => {
    prismaMock.qrScanDraft.findMany.mockResolvedValue([
      {
        id: 'draft_duplicate_receipt',
        created_at: new Date('2026-05-26T00:00:00.000Z'),
        parsed_data: {
          medications: [{ drugCode: 'RC_DUP', drugName: '曖昧レセ電薬' }],
        },
      },
    ]);
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        id: 'stock_receipt_candidate',
        drug_master_id: 'drug_receipt_a',
        reorder_point: 3,
        updated_at: new Date('2026-05-22T00:00:00.000Z'),
        drug_master: {
          id: 'drug_receipt_a',
          yj_code: '111111111111',
          drug_name: '曖昧候補A',
          generic_name: null,
          drug_price: 10,
          unit: '錠',
          is_generic: false,
        },
      },
    ]);
    prismaMock.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_receipt_a',
        yj_code: '111111111111',
        receipt_code: 'RC_DUP',
        hot_code: null,
        drug_name: '曖昧候補A',
        generic_name: null,
        drug_price: 10,
        unit: '錠',
        is_generic: false,
      },
      {
        id: 'drug_receipt_b',
        yj_code: '222222222222',
        receipt_code: 'RC_DUP',
        hot_code: null,
        drug_name: '曖昧候補B',
        generic_name: null,
        drug_price: 20,
        unit: '錠',
        is_generic: false,
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totals: {
        matched_drug_count: 0,
        unmatched_drug_count: 1,
        frequent_unstocked_count: 1,
        unused_stocked_count: 0,
        possibly_used_stocked_count: 1,
      },
      frequent_unstocked: [
        expect.objectContaining({
          drug_code: 'RC_DUP',
          drug_name: '曖昧レセ電薬',
          matched_drug: null,
          mismatch_kind: 'resolver_review_required',
          resolution_status: 'ambiguous_code',
          source_code_system: null,
          candidate_code_systems: ['receipt'],
          candidate_count: 2,
        }),
      ],
      unmatched_prescribed: [
        expect.objectContaining({
          drug_code: 'RC_DUP',
          drug_name: '曖昧レセ電薬',
          mismatch_kind: 'resolver_review_required',
          resolution_status: 'ambiguous_code',
          source_code_system: null,
          candidate_code_systems: ['receipt'],
          candidate_count: 2,
        }),
      ],
      unused_stocked: [],
      possibly_used_stocked: [
        expect.objectContaining({
          id: 'stock_receipt_candidate',
          drug_master_id: 'drug_receipt_a',
          usage_status: 'unknown_due_to_ambiguous_code',
        }),
      ],
    });
  });

  it('returns list count metadata for sliced unmatched prescribed rows', async () => {
    prismaMock.qrScanDraft.findMany.mockResolvedValue([
      {
        id: 'draft_unmatched_newer',
        created_at: new Date('2026-05-27T00:00:00.000Z'),
        parsed_data: {
          medications: [{ drugCode: 'NO_MATCH_2', drugName: '未照合薬2' }],
        },
      },
      {
        id: 'draft_unmatched_older',
        created_at: new Date('2026-05-26T00:00:00.000Z'),
        parsed_data: {
          medications: [{ drugCode: 'NO_MATCH_1', drugName: '未照合薬1' }],
        },
      },
    ]);
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
    prismaMock.drugMaster.findMany.mockResolvedValue([]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=1&limit=1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totals: {
        unmatched_drug_count: 2,
        frequent_unstocked_count: 2,
      },
      list_counts: {
        frequent_unstocked: expect.objectContaining({
          total_count: 2,
          visible_count: 1,
          hidden_count: 1,
          truncated: true,
          count_basis: 'unique_prescribed_drug_code_or_name',
        }),
        unmatched_prescribed: expect.objectContaining({
          total_count: 2,
          visible_count: 1,
          hidden_count: 1,
          truncated: true,
          count_basis: 'unique_prescribed_drug_code_or_name',
        }),
        unused_stocked: expect.objectContaining({
          total_count: 0,
          visible_count: 0,
          hidden_count: 0,
          truncated: false,
        }),
      },
      unmatched_prescribed: [
        expect.objectContaining({
          drug_code: 'NO_MATCH_2',
          resolution_status: 'code_not_found',
          mismatch_kind: 'unresolved_prescription',
        }),
      ],
    });
  });

  it('rejects another org site before reading QR drafts', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(prismaMock.qrScanDraft.findMany).not.toHaveBeenCalled();
  });
});
