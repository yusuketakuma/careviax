import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  drugMasterFindManyMock,
  drugMasterCountMock,
  genericDrugMappingFindManyMock,
  pharmacySiteFindFirstMock,
  pharmacyDrugStockFindManyMock,
} = vi.hoisted(() => ({
  drugMasterFindManyMock: vi.fn(),
  drugMasterCountMock: vi.fn(),
  genericDrugMappingFindManyMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  pharmacyDrugStockFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    drugMaster: {
      findMany: drugMasterFindManyMock,
      count: drugMasterCountMock,
    },
    genericDrugMapping: {
      findMany: genericDrugMappingFindManyMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
    pharmacyDrugStock: {
      findMany: pharmacyDrugStockFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url);
}

describe('/api/drug-masters GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '123456789012',
        receipt_code: null,
        jan_code: null,
        drug_name: 'アムロジピンOD錠5mg',
        drug_name_kana: 'アムロジピン',
        generic_name: 'アムロジピンベシル酸塩',
        drug_price: 12.3,
        unit: '錠',
        dosage_form: '錠剤',
        therapeutic_category: '2171',
        manufacturer: 'テスト製薬',
        is_generic: true,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: true,
        is_lasa_risk: true,
        tall_man_name: 'amLODIPine OD錠5mg',
        lasa_group_key: 'amlodipine_amiodarone',
        max_administration_days: null,
      },
    ]);
    drugMasterCountMock.mockResolvedValue(1);
    pharmacySiteFindFirstMock.mockResolvedValue({ id: 'site_1' });
    pharmacyDrugStockFindManyMock.mockResolvedValue([]);
    genericDrugMappingFindManyMock.mockResolvedValue([
      {
        generic_name: 'アムロジピンベシル酸塩',
        price_comparison: {
          lowest_price: '10.5',
          standard_name: 'アムロジピンOD錠5mg',
          dosage_form: '錠剤',
        },
      },
    ]);
  });

  it('attaches site-specific formulary status and supports stocked-only filtering', async () => {
    pharmacyDrugStockFindManyMock.mockResolvedValue([
      {
        id: 'stock_1',
        drug_master_id: 'drug_1',
        is_stocked: true,
        stock_qty: null,
        reorder_point: 10,
        preferred_generic_id: null,
        updated_at: new Date('2026-05-27T00:00:00.000Z'),
        preferred_generic: null,
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/drug-masters?site_id=site_1&stocked=true&limit=5'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(pharmacySiteFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'site_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
      },
    });
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          drug_stocks: {
            some: {
              org_id: 'org_1',
              site_id: 'site_1',
              is_stocked: true,
            },
          },
        }),
      }),
    );
    expect(pharmacyDrugStockFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          drug_master_id: { in: ['drug_1'] },
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'drug_1',
          stock_config: expect.objectContaining({
            id: 'stock_1',
            is_stocked: true,
            reorder_point: 10,
          }),
        }),
      ],
    });
  });

  it('attaches generic price-comparison data for generic candidate searches', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/drug-masters?q=%E3%82%A2%E3%83%A0%E3%83%AD&generic=true&limit=5',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(genericDrugMappingFindManyMock).toHaveBeenCalledWith({
      where: {
        generic_name: {
          in: ['アムロジピンベシル酸塩'],
        },
      },
      select: {
        generic_name: true,
        price_comparison: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          drug_name: 'アムロジピンOD錠5mg',
          tall_man_name: 'amLODIPine OD錠5mg',
          is_high_risk: true,
          is_lasa_risk: true,
          generic_price_comparison: expect.objectContaining({
            lowest_price: '10.5',
          }),
        }),
      ],
    });
  });

  it('supports high-risk and LASA filters for medication-safety review', async () => {
    const response = await GET(
      createRequest('http://localhost/api/drug-masters?highRisk=true&lasa=true&limit=5'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_high_risk: true,
          is_lasa_risk: true,
        }),
        select: expect.objectContaining({
          is_high_risk: true,
          is_lasa_risk: true,
          tall_man_name: true,
          lasa_group_key: true,
        }),
      }),
    );
  });

  it.each(['abc', '-10', '25abc'])('uses a safe offset for malformed cursor %s', async (cursor) => {
    const response = await GET(
      createRequest(`http://localhost/api/drug-masters?cursor=${encodeURIComponent(cursor)}`),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 51,
      }),
    );
  });

  it('searches practical drug identifiers and display aliases', async () => {
    const response = await GET(
      createRequest('http://localhost/api/drug-masters?q=1234567&limit=5'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { drug_name: { contains: '1234567', mode: 'insensitive' } },
            { drug_name_kana: { contains: '1234567', mode: 'insensitive' } },
            { generic_name: { contains: '1234567', mode: 'insensitive' } },
            { tall_man_name: { contains: '1234567', mode: 'insensitive' } },
            { manufacturer: { contains: '1234567', mode: 'insensitive' } },
            { yj_code: { startsWith: '1234567' } },
            { receipt_code: { startsWith: '1234567' } },
            { hot_code: { startsWith: '1234567' } },
            { jan_code: { startsWith: '1234567' } },
          ]),
        }),
      }),
    );
  });
});
