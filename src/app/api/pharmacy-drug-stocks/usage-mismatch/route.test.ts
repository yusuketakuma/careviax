import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    qrScanDraft: { findMany: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn() },
    drugMaster: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

import { GET } from './route';

function createRequest(
  url = 'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1',
) {
  return new NextRequest(url, {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/pharmacy-drug-stocks/usage-mismatch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
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
        'http://localhost/api/pharmacy-drug-stocks/usage-mismatch?site_id=site_1&frequent_threshold=2',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
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
        displayed_frequent_unstocked_count: 1,
        displayed_unused_stocked_count: 1,
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
    expect(prismaMock.qrScanDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          status: { not: 'discarded' },
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

  it('rejects another org site before reading QR drafts', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(prismaMock.qrScanDraft.findMany).not.toHaveBeenCalled();
  });
});
