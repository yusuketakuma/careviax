import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findFirst: vi.fn() },
    pharmacyDrugStock: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/pharmacy-drug-stocks', {
    method: 'POST',
    body: '{"site_id":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/pharmacy-drug-stocks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.pharmacyDrugStock.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('returns the current stock config for a selected drug and site', async () => {
    prismaMock.pharmacyDrugStock.findFirst.mockResolvedValue({
      id: 'stock_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      is_stocked: true,
      stock_qty: null,
      reorder_point: null,
      preferred_generic_id: 'generic_1',
      adoption_source: 'manual',
      adoption_note: null,
      last_reviewed_at: null,
      reviewed_by_id: null,
      updated_at: new Date('2026-03-28T00:00:00Z'),
      preferred_generic: {
        id: 'generic_1',
        drug_name: 'アムロジピン錠5mg「GE」',
        yj_code: '123456789012',
      },
    });

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks?site_id=site_1&drug_master_id=drug_1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'stock_1',
        is_stocked: true,
        preferred_generic_id: 'generic_1',
      },
      site: {
        id: 'site_1',
      },
    });
  });

  it('searches stocked formulary rows by practical drug master identifiers', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        id: 'stock_1',
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        is_stocked: true,
        stock_qty: null,
        reorder_point: 10,
        preferred_generic_id: null,
        adoption_source: 'manual',
        adoption_note: null,
        last_reviewed_at: null,
        reviewed_by_id: null,
        follow_up_status: null,
        follow_up_reason: null,
        follow_up_due_date: null,
        follow_up_resolved_at: null,
        updated_at: new Date('2026-03-28T00:00:00Z'),
        drug_master: {
          id: 'drug_1',
          drug_name: 'アムロジピンOD錠5mg',
          yj_code: '123456789012',
          drug_price: 12.3,
          unit: '錠',
          is_generic: true,
          is_narcotic: false,
          is_psychotropic: false,
          is_high_risk: false,
          is_lasa_risk: false,
          transitional_expiry_date: null,
        },
        preferred_generic: null,
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks?site_id=site_1&q=4987123&limit=%2020%20',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          is_stocked: true,
          drug_master: {
            OR: expect.arrayContaining([
              { tall_man_name: { contains: '4987123' } },
              { manufacturer: { contains: '4987123' } },
              { hot_code: { startsWith: '4987123' } },
              { jan_code: { startsWith: '4987123' } },
            ]),
          },
        }),
        take: 20,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'stock_1',
          drug_master: {
            drug_name: 'アムロジピンOD錠5mg',
          },
        },
      ],
    });
  });

  it('rejects malformed limit values before loading the site', async () => {
    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stocks?site_id=site_1&limit=20.0'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        limit: ['limit は整数で指定してください'],
      },
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('upserts stock adoption with a preferred generic', async () => {
    prismaMock.drugMaster.findFirst
      .mockResolvedValueOnce({
        id: 'drug_1',
        drug_name: 'ノルバスク錠5mg',
        generic_name: 'アムロジピンベシル酸塩錠',
        is_generic: false,
      })
      .mockResolvedValueOnce({
        id: 'generic_1',
        drug_name: 'アムロジピン錠5mg「GE」',
        yj_code: '123456789012',
        is_generic: true,
        generic_name: 'アムロジピンベシル酸塩錠',
      });
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({
      id: 'stock_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      is_stocked: true,
      stock_qty: null,
      reorder_point: null,
      preferred_generic_id: 'generic_1',
      adoption_source: 'manual',
      adoption_note: null,
      last_reviewed_at: null,
      reviewed_by_id: null,
      updated_at: new Date('2026-03-28T00:00:00Z'),
      preferred_generic: {
        id: 'generic_1',
        drug_name: 'アムロジピン錠5mg「GE」',
        yj_code: '123456789012',
      },
    });

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stocks', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        is_stocked: true,
        preferred_generic_id: 'generic_1',
        reorder_point: 12,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          preferred_generic_id: 'generic_1',
          reorder_point: 12,
        }),
        update: expect.objectContaining({
          is_stocked: true,
          preferred_generic_id: 'generic_1',
          reorder_point: 12,
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_drug_stock_created',
          target_type: 'PharmacyDrugStock',
        }),
      }),
    );
  });

  it('stores follow-up due dates from explicit ISO date-time strings', async () => {
    const expectedDueDate = new Date('2026-06-01T00:30:00.000Z');
    prismaMock.drugMaster.findFirst.mockResolvedValueOnce({
      id: 'drug_1',
      drug_name: 'ハイリスク薬',
      generic_name: null,
      is_generic: false,
    });
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({
      id: 'stock_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      is_stocked: true,
      stock_qty: null,
      reorder_point: null,
      preferred_generic_id: null,
      adoption_source: 'manual',
      adoption_note: null,
      last_reviewed_at: null,
      reviewed_by_id: null,
      follow_up_status: 'monitoring',
      follow_up_reason: '安全性確認',
      follow_up_due_date: expectedDueDate,
      follow_up_resolved_at: null,
      updated_at: new Date('2026-03-28T00:00:00Z'),
      preferred_generic: null,
    });

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stocks', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        is_stocked: true,
        follow_up_status: 'monitoring',
        follow_up_reason: '安全性確認',
        follow_up_due_date: '2026-06-01T09:30:00+09:00',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          follow_up_status: 'monitoring',
          follow_up_reason: '安全性確認',
          follow_up_due_date: expectedDueDate,
          follow_up_resolved_at: null,
        }),
        update: expect.objectContaining({
          follow_up_status: 'monitoring',
          follow_up_reason: '安全性確認',
          follow_up_due_date: expectedDueDate,
          follow_up_resolved_at: null,
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: expect.objectContaining({
            after: expect.objectContaining({
              follow_up_due_date: '2026-06-01T00:30:00.000Z',
            }),
          }),
        }),
      }),
    );
  });

  it('rejects non-object request bodies before stock lookup or mutation', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stocks', ['unexpected']),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['numeric timestamp', 0],
    ['invalid calendar date', '2026-02-30'],
    ['non-ISO text', 'tomorrow'],
  ])('rejects %s follow-up due dates before stock lookup or mutation', async (_label, value) => {
    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stocks', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        is_stocked: true,
        follow_up_status: 'monitoring',
        follow_up_due_date: value,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        follow_up_due_date: ['follow_up_due_date は YYYY-MM-DD または ISO日時で指定してください'],
      },
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before stock lookup or mutation', async () => {
    const response = await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects unknown preferred generic before stock mutation side effects', async () => {
    prismaMock.drugMaster.findFirst
      .mockResolvedValueOnce({
        id: 'drug_1',
        drug_name: 'ノルバスク錠5mg',
        generic_name: 'アムロジピンベシル酸塩錠',
        is_generic: false,
      })
      .mockResolvedValueOnce(null);

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stocks', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        is_stocked: true,
        preferred_generic_id: 'missing_generic',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '採用後発薬が見つかりません',
      details: {
        preferred_generic_id: ['存在する後発品を選択してください'],
      },
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects the target drug itself as preferred generic', async () => {
    prismaMock.drugMaster.findFirst
      .mockResolvedValueOnce({
        id: 'drug_1',
        drug_name: 'アムロジピン錠5mg「GE」',
        generic_name: 'アムロジピンベシル酸塩錠',
        is_generic: true,
      })
      .mockResolvedValueOnce({
        id: 'drug_1',
        drug_name: 'アムロジピン錠5mg「GE」',
        yj_code: '123456789012',
        is_generic: true,
        generic_name: 'アムロジピンベシル酸塩錠',
      });

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stocks', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        is_stocked: true,
        preferred_generic_id: 'drug_1',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '採用後発薬に対象薬自身は指定できません',
      details: {
        preferred_generic_id: ['対象薬とは別の後発品を選択してください'],
      },
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
