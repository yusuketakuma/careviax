import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { GET } from './route';

function createRequest(url = 'http://localhost/api/pharmacy-drug-stocks/export?site_id=site_1') {
  return {
    url,
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stocks/export', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('exports stocked formulary rows as BOM-prefixed CSV and records audit log', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        is_stocked: true,
        reorder_point: 10,
        adoption_note: '棚卸確認済み',
        last_reviewed_at: new Date('2026-05-20T00:00:00.000Z'),
        drug_master: {
          yj_code: '123456789012',
          receipt_code: '123456789',
          drug_name: 'アムロジピン錠5mg',
          generic_name: 'アムロジピン',
          drug_price: '10.20',
          unit: '錠',
          manufacturer: 'PH-OS製薬',
          is_narcotic: false,
          is_psychotropic: false,
          is_high_risk: true,
          is_lasa_risk: true,
        },
        preferred_generic: {
          yj_code: '123456789099',
          drug_name: 'アムロジピン後発錠5mg',
        },
      },
    ]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('formulary-operations-site_1-');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = Buffer.from(bytes.slice(3)).toString('utf8');
    expect(csv).toContain('"YJコード","レセ電コード","医薬品名"');
    expect(csv).toContain('"メーカー","安全属性","採用"');
    expect(csv).toContain('"123456789012","123456789","アムロジピン錠5mg"');
    expect(csv).toContain('"PH-OS製薬","ハイリスク / LASA","採用"');
    expect(csv).toContain('"123456789099","アムロジピン後発錠5mg","2026-05-20"');
    expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', site_id: 'site_1', is_stocked: true },
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          actor_id: 'user_1',
          action: 'pharmacy_drug_stock_exported',
          target_id: 'site_1',
          changes: { site_id: 'site_1', purpose: 'operations', row_count: 1 },
        }),
      }),
    );
  });

  it('exports a purpose-specific posting CSV with a scoped audit log', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        is_stocked: true,
        reorder_point: 5,
        adoption_note: '在宅向け採用',
        last_reviewed_at: new Date('2026-05-20T00:00:00.000Z'),
        follow_up_status: 'resolved',
        follow_up_reason: null,
        follow_up_due_date: null,
        updated_at: new Date('2026-05-21T00:00:00.000Z'),
        drug_master: {
          yj_code: '123456789012',
          receipt_code: '123456789',
          drug_name: 'アムロジピン錠5mg',
          generic_name: 'アムロジピン',
          drug_price: '10.20',
          unit: '錠',
          dosage_form: '内用薬',
          manufacturer: 'PH-OS製薬',
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
      createRequest('http://localhost/api/pharmacy-drug-stocks/export?site_id=site_1&purpose=posting'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('formulary-posting-site_1-');
    const csv = await response.text();
    expect(csv).toContain('"医薬品名","一般名","剤形","単位","メーカー","備考"');
    expect(csv).toContain('"アムロジピン錠5mg","アムロジピン","内用薬","錠","PH-OS製薬","在宅向け採用"');
    expect(csv).not.toContain('"YJコード","レセ電コード"');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: { site_id: 'site_1', purpose: 'posting', row_count: 1 },
        }),
      }),
    );
  });

  it('exports audit CSV with safety flags and follow-up fields', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        is_stocked: true,
        reorder_point: 3,
        adoption_note: '監査対象',
        last_reviewed_at: new Date('2026-05-20T00:00:00.000Z'),
        follow_up_status: 'monitoring',
        follow_up_reason: '安全性確認',
        follow_up_due_date: new Date('2026-06-01T00:00:00.000Z'),
        updated_at: new Date('2026-05-21T00:00:00.000Z'),
        drug_master: {
          yj_code: '987654321098',
          receipt_code: '987654321',
          drug_name: '安全確認薬',
          generic_name: null,
          drug_price: '30.00',
          unit: '錠',
          dosage_form: '内用薬',
          manufacturer: 'PH-OS製薬',
          is_narcotic: true,
          is_psychotropic: true,
          is_high_risk: true,
          is_lasa_risk: false,
          transitional_expiry_date: null,
        },
        preferred_generic: null,
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stocks/export?site_id=site_1&purpose=audit'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain('"メーカー","安全属性","採用"');
    expect(csv).toContain('"PH-OS製薬","麻薬 / 向精神薬 / ハイリスク","採用"');
    expect(csv).toContain('"monitoring","安全性確認","2026-06-01","2026-05-21"');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: { site_id: 'site_1', purpose: 'audit', row_count: 1 },
        }),
      }),
    );
  });

  it('neutralizes spreadsheet formula prefixes in CSV cells', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        is_stocked: true,
        reorder_point: null,
        adoption_note: '=HYPERLINK("https://example.test")',
        last_reviewed_at: null,
        drug_master: {
          yj_code: '123456789012',
          receipt_code: null,
          drug_name: '+危険な薬名',
          generic_name: '\tタブ開始一般名',
          drug_price: null,
          unit: '錠',
          manufacturer: '@メーカー',
        },
        preferred_generic: null,
      },
    ]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain(`"'+危険な薬名"`);
    expect(csv).toContain(`"'\tタブ開始一般名"`);
    expect(csv).toContain(`"'@メーカー"`);
    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).not.toContain(`"=HYPERLINK(""https://example.test"")"`);
  });

  it('rejects export for another org site before querying stocks or writing audit log', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
