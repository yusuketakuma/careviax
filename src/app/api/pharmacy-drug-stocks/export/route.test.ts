import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
import {
  expectPhiExportSnapshotRedacted,
  expectSensitiveNoStore,
} from '@/test/api-response-assertions';

function createRequest(url = 'http://localhost/api/pharmacy-drug-stocks/export?site_id=site_1') {
  return new NextRequest(url, {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/pharmacy-drug-stocks/export', () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    vi.useRealTimers();
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('exports stocked formulary rows as BOM-prefixed CSV and records audit log', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T15:30:00.000Z'));
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        is_stocked: true,
        reorder_point: 10,
        adoption_note: '棚卸確認済み',
        last_reviewed_at: new Date('2026-05-20T15:30:00.000Z'),
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
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="${encodeURIComponent('formulary-operations-2026-04-02.csv')}"; filename*=UTF-8''${encodeURIComponent('formulary-operations-2026-04-02.csv')}`,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = Buffer.from(bytes.slice(3)).toString('utf8');
    expect(csv).toContain('"YJコード","レセ電コード","医薬品名"');
    expect(csv).toContain('"メーカー","安全属性","採用"');
    expect(csv).toContain('"123456789012","123456789","アムロジピン錠5mg"');
    expect(csv).toContain('"PH-OS製薬","ハイリスク / LASA","採用"');
    expect(csv).toContain('"123456789099","アムロジピン後発錠5mg","2026-05-21"');
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
          action: 'export',
          target_type: 'pharmacy_drug_stock',
          target_id: 'site_1',
          changes: {
            format: 'csv',
            record_count: 1,
            filters: { purpose: 'operations' },
            metadata: {
              source: 'pharmacy_drug_stocks_export',
              export_surface_id: 'pharmacy_drug_stocks_operations_csv',
            },
          },
        }),
      }),
    );
    expectPhiExportSnapshotRedacted(JSON.stringify(prismaMock.auditLog.create.mock.calls), [
      'site_id',
    ]);
  });

  it('exports a purpose-specific posting CSV with a scoped audit log', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        is_stocked: true,
        reorder_point: 5,
        adoption_note: '在宅向け採用 山田 太郎 090-1234-5678 token=secret',
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
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/export?site_id=site_1&purpose=posting',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('formulary-posting-');
    expect(disposition).not.toContain('site_1');
    const csv = await response.text();
    expect(csv).toContain('"医薬品名","一般名","剤形","単位","メーカー"');
    expect(csv).toContain('"アムロジピン錠5mg","アムロジピン","内用薬","錠","PH-OS製薬"');
    expect(csv).not.toContain('"YJコード","レセ電コード"');
    expect(csv).not.toContain('在宅向け採用');
    expect(csv).not.toContain('090-1234-5678');
    expect(csv).not.toContain('山田 太郎');
    expect(csv).not.toContain('token=secret');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: {
            format: 'csv',
            record_count: 1,
            filters: { purpose: 'posting' },
            metadata: {
              source: 'pharmacy_drug_stocks_export',
              export_surface_id: 'pharmacy_drug_stocks_posting_csv',
            },
          },
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
        follow_up_due_date: new Date('2026-06-01T15:30:00.000Z'),
        updated_at: new Date('2026-05-21T15:30:00.000Z'),
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
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/export?site_id=site_1&purpose=audit',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const csv = await response.text();
    expect(csv).toContain('"メーカー","安全属性","採用"');
    expect(csv).toContain('"PH-OS製薬","麻薬 / 向精神薬 / ハイリスク","採用"');
    expect(csv).toContain('"monitoring","安全性確認","2026-06-02","2026-05-22"');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: {
            format: 'csv',
            record_count: 1,
            filters: { purpose: 'audit' },
            metadata: {
              source: 'pharmacy_drug_stocks_export',
              export_surface_id: 'pharmacy_drug_stocks_audit_csv',
            },
          },
        }),
      }),
    );
  });

  it('exports pharmacist review CSV with review-specific safety fields', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        is_stocked: true,
        reorder_point: 7,
        adoption_note: '薬剤師レビュー対象',
        last_reviewed_at: new Date('2026-05-20T00:00:00.000Z'),
        follow_up_status: 'monitoring',
        follow_up_reason: '安全性確認',
        follow_up_due_date: new Date('2026-06-01T00:00:00.000Z'),
        updated_at: new Date('2026-05-21T00:00:00.000Z'),
        drug_master: {
          yj_code: '111222333444',
          receipt_code: '111222333',
          drug_name: 'レビュー薬',
          generic_name: 'レビュー一般名',
          drug_price: '120.50',
          unit: '錠',
          dosage_form: '内用薬',
          manufacturer: 'PH-OS製薬',
          is_narcotic: true,
          is_psychotropic: false,
          is_high_risk: false,
          is_lasa_risk: true,
          transitional_expiry_date: new Date('2026-07-31T15:30:00.000Z'),
        },
        preferred_generic: {
          yj_code: '111222333999',
          drug_name: 'レビュー後発品',
        },
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/export?site_id=site_1&purpose=pharmacist_review',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const csv = await response.text();
    expect(csv).toContain(
      '"YJコード","医薬品名","一般名","薬価","単位","発注点","優先後発品名","最終レビュー日","フォローアップ状態","経過措置期限","安全属性","メモ"',
    );
    expect(csv).toContain(
      '"111222333444","レビュー薬","レビュー一般名","120.50","錠","7","レビュー後発品","2026-05-20","monitoring","2026-08-01","麻薬 / LASA","薬剤師レビュー対象"',
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: {
            format: 'csv',
            record_count: 1,
            filters: { purpose: 'pharmacist_review' },
            metadata: {
              source: 'pharmacy_drug_stocks_export',
              export_surface_id: 'pharmacy_drug_stocks_pharmacist_review_csv',
            },
          },
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
    expectSensitiveNoStore(response);
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects invalid export purpose with sensitive no-store headers', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/export?site_id=site_1&purpose=partner',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('fails closed before returning CSV when export audit persistence fails', async () => {
    prismaMock.auditLog.create.mockRejectedValueOnce(
      new Error('audit storage failed for patient 山田 太郎 token=secret'),
    );
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        is_stocked: true,
        reorder_point: 10,
        adoption_note: '棚卸確認済み',
        last_reviewed_at: null,
        follow_up_status: null,
        follow_up_reason: null,
        follow_up_due_date: null,
        updated_at: null,
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
          is_high_risk: true,
          is_lasa_risk: true,
          transitional_expiry_date: null,
        },
        preferred_generic: null,
      },
    ]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.text();
    expect(body).toContain('PHARMACY_DRUG_STOCK_EXPORT_AUDIT_FAILED');
    expect(body).not.toContain('アムロジピン');
    expect(body).not.toContain('山田 太郎');
    expect(body).not.toContain('token=secret');
  });

  it('returns a no-store fixed error when stock loading fails with hostile raw text', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockRejectedValueOnce(
      new Error('stock read failed for patient 山田 太郎 アムロジピン token=secret'),
    );

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-type') ?? '').not.toContain('text/csv');
    const body = await response.text();
    expect(body).toContain('PHARMACY_DRUG_STOCK_EXPORT_FAILED');
    expect(body).not.toContain('stock read failed');
    expect(body).not.toContain('山田 太郎');
    expect(body).not.toContain('アムロジピン');
    expect(body).not.toContain('token=secret');
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('encodes CRLF characters out of the download filename', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue({
      id: 'site_1\r\nX-Injected: yes',
      name: '本店',
    });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('formulary-operations-');
    expect(disposition).not.toContain('site_1');
    expect(disposition).not.toContain('X-Injected');
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
  });
});
