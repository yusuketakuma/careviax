import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findMany: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn(), upsert: vi.fn() },
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

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    url: 'http://localhost/api/pharmacy-drug-stocks/bulk',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stocks/bulk', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({ id: 'stock_1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('imports CSV rows by YJ code and reports unmatched rows', async () => {
    prismaMock.drugMaster.findMany
      .mockResolvedValueOnce([
        {
          id: 'drug_1',
          yj_code: '123456789012',
          drug_name: 'アムロジピン錠5mg',
          generic_name: 'アムロジピン',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await POST(
      createRequest({
        site_id: 'site_1',
        csv: 'YJコード,医薬品名,採用,発注点\n123456789012,アムロジピン錠5mg,採用,10\n999999999999,不明薬,採用,5',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedCount: 1,
      unmatchedRows: [{ rowNumber: 3, yj_code: '999999999999' }],
    });
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          reorder_point: 10,
          adoption_source: 'csv',
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledOnce();
  });

  it('previews CSV differences without mutating stock rows or writing audit logs', async () => {
    prismaMock.drugMaster.findMany
      .mockResolvedValueOnce([
        {
          id: 'drug_new',
          yj_code: '111111111111',
          drug_name: '新規薬',
          generic_name: '成分A',
        },
        {
          id: 'drug_existing',
          yj_code: '222222222222',
          drug_name: '既存薬',
          generic_name: '成分B',
        },
        {
          id: 'drug_stop',
          yj_code: '333333333333',
          drug_name: '解除薬',
          generic_name: '成分C',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        drug_master_id: 'drug_existing',
        is_stocked: true,
        reorder_point: 5,
        preferred_generic_id: null,
        adoption_note: null,
      },
      {
        drug_master_id: 'drug_stop',
        is_stocked: true,
        reorder_point: 10,
        preferred_generic_id: null,
        adoption_note: '旧メモ',
      },
    ]);

    const response = await POST(
      createRequest({
        site_id: 'site_1',
        dry_run: true,
        csv: [
          'YJコード,医薬品名,採用,発注点,メモ',
          '111111111111,新規薬,採用,3,新規',
          '222222222222,既存薬,採用,8,変更',
          '333333333333,解除薬,解除,10,旧メモ',
          '999999999999,不明薬,採用,1,',
        ].join('\n'),
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedCount: 0,
      unmatchedRows: [{ rowNumber: 5, yj_code: '999999999999' }],
      preview: {
        summary: {
          totalRows: 4,
          processableRows: 3,
          createCount: 1,
          updateCount: 1,
          deactivateCount: 1,
          unmatchedCount: 1,
          invalidCount: 0,
        },
        rows: [
          { rowNumber: 2, status: 'create', yj_code: '111111111111' },
          {
            rowNumber: 3,
            status: 'update',
            yj_code: '222222222222',
            before: { reorder_point: 5, adoption_note: null },
            after: { reorder_point: 8, adoption_note: '変更' },
          },
          { rowNumber: 4, status: 'deactivate', yj_code: '333333333333' },
          { rowNumber: 5, status: 'unmatched', yj_code: '999999999999' },
        ],
      },
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects rows with unresolved preferred generic codes without importing the drug', async () => {
    prismaMock.drugMaster.findMany
      .mockResolvedValueOnce([
        {
          id: 'drug_1',
          yj_code: '123456789012',
          drug_name: 'アムロジピン錠5mg',
          generic_name: 'アムロジピン',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await POST(
      createRequest({
        site_id: 'site_1',
        csv: 'YJコード,医薬品名,採用,優先後発品YJコード\n123456789012,アムロジピン錠5mg,採用,999999999999',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      importedCount: 0,
      invalidRows: [
        {
          rowNumber: 2,
          reason: '優先後発品YJコードが見つからないか、後発品ではありません',
        },
      ],
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects name-only rows when the drug name matches multiple masters', async () => {
    prismaMock.drugMaster.findMany
      .mockResolvedValueOnce([
        { id: 'drug_1', yj_code: '111111111111', drug_name: '同名薬', generic_name: '成分A' },
        { id: 'drug_2', yj_code: '222222222222', drug_name: '同名薬', generic_name: '成分B' },
      ])
      .mockResolvedValueOnce([]);

    const response = await POST(
      createRequest({
        site_id: 'site_1',
        csv: '医薬品名,採用,発注点\n同名薬,採用,10',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      importedCount: 0,
      invalidRows: [
        {
          rowNumber: 2,
          reason: '医薬品名に複数候補があります。YJコードを指定してください',
        },
      ],
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects preferred generic rows with a different generic name', async () => {
    prismaMock.drugMaster.findMany
      .mockResolvedValueOnce([
        {
          id: 'drug_1',
          yj_code: '123456789012',
          drug_name: '先発薬A錠',
          generic_name: '成分A',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'generic_1',
          yj_code: '999999999999',
          drug_name: '後発薬B錠',
          generic_name: '成分B',
        },
      ]);

    const response = await POST(
      createRequest({
        site_id: 'site_1',
        csv: 'YJコード,医薬品名,採用,優先後発品YJコード\n123456789012,先発薬A錠,採用,999999999999',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedCount: 0,
      invalidRows: [
        {
          rowNumber: 2,
          reason: '優先後発品は同一一般名から選択してください',
        },
      ],
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects the target drug itself as a preferred generic in CSV rows', async () => {
    prismaMock.drugMaster.findMany
      .mockResolvedValueOnce([
        {
          id: 'drug_1',
          yj_code: '123456789012',
          drug_name: 'アムロジピン後発錠',
          generic_name: 'アムロジピン',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'drug_1',
          yj_code: '123456789012',
          drug_name: 'アムロジピン後発錠',
          generic_name: 'アムロジピン',
        },
      ]);

    const response = await POST(
      createRequest({
        site_id: 'site_1',
        csv: 'YJコード,医薬品名,採用,優先後発品YJコード\n123456789012,アムロジピン後発錠,採用,123456789012',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedCount: 0,
      invalidRows: [
        {
          rowNumber: 2,
          reason: '優先後発品に対象薬自身は指定できません',
        },
      ],
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
