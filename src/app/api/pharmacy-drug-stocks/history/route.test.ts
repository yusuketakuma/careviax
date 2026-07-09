import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const { authMock, loggerErrorMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { GET } from './route';

function createRequest(
  url = 'http://localhost/api/pharmacy-drug-stocks/history?site_id=site_1&drug_master_id=drug_1&limit=%203%20',
) {
  return new NextRequest(url, {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/pharmacy-drug-stocks/history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.pharmacyDrugStock.findFirst.mockResolvedValue({
      id: 'stock_1',
      drug_master_id: 'drug_1',
    });
  });

  it('returns stock-specific audit logs and matching site review logs', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit_stock',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_updated',
        target_type: 'PharmacyDrugStock',
        target_id: 'stock_1',
        changes: { drug_master_id: 'drug_1' },
        created_at: new Date('2026-05-27T00:00:00.000Z'),
      },
      {
        id: 'audit_review_match',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_reviewed',
        target_type: 'PharmacySite',
        target_id: 'site_1',
        changes: { drug_master_ids: ['drug_1', 'drug_2'] },
        created_at: new Date('2026-05-26T00:00:00.000Z'),
      },
      {
        id: 'audit_bulk_summary_match',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_bulk_import_summary',
        target_type: 'PharmacySite',
        target_id: 'site_1',
        changes: {
          rows: [
            { row_number: 2, drug_master_id: 'drug_1', status: 'update' },
            { row_number: 3, drug_master_id: 'drug_other', status: 'create' },
          ],
        },
        created_at: new Date('2026-05-25T12:00:00.000Z'),
      },
      {
        id: 'audit_review_other',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_reviewed',
        target_type: 'PharmacySite',
        target_id: 'site_1',
        changes: { drug_master_ids: ['drug_other'] },
        created_at: new Date('2026-05-25T00:00:00.000Z'),
      },
    ]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      site: { id: 'site_1' },
      stock: { id: 'stock_1', drug_master_id: 'drug_1' },
      data: [
        { id: 'audit_stock', action: 'pharmacy_drug_stock_updated' },
        { id: 'audit_review_match', action: 'pharmacy_drug_stock_reviewed' },
        { id: 'audit_bulk_summary_match', action: 'pharmacy_drug_stock_bulk_import_summary' },
      ],
    });
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: expect.arrayContaining([
            { target_type: 'PharmacyDrugStock', target_id: 'stock_1' },
            {
              target_type: 'PharmacySite',
              target_id: 'site_1',
              action: {
                in: ['pharmacy_drug_stock_reviewed', 'pharmacy_drug_stock_bulk_import_summary'],
              },
            },
          ]),
        }),
        take: 12,
      }),
    );
  });

  it('rejects malformed limit values before querying the site', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/history?site_id=site_1&drug_master_id=drug_1&limit=3abc',
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
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('skips malformed site audit changes while keeping object-shaped matching rows', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit_array_changes',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_reviewed',
        target_type: 'PharmacySite',
        target_id: 'site_1',
        changes: ['drug_1'],
        created_at: new Date('2026-05-27T00:00:00.000Z'),
      },
      {
        id: 'audit_bulk_summary_match',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_bulk_import_summary',
        target_type: 'PharmacySite',
        target_id: 'site_1',
        changes: {
          rows: [null, 'drug_1', { row_number: 2, drug_master_id: 'drug_1', status: 'update' }],
        },
        created_at: new Date('2026-05-26T00:00:00.000Z'),
      },
    ]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'audit_bulk_summary_match', action: 'pharmacy_drug_stock_bulk_import_summary' }],
    });
  });

  it('returns an empty history when the drug is not configured for the site', async () => {
    prismaMock.pharmacyDrugStock.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      stock: null,
      data: [],
    });
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('rejects another org site before querying stock history', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('marks unauthenticated responses as no-store before handler execution', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_UNAUTHENTICATED',
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('marks sanitized unexpected errors as no-store', async () => {
    const rawMessage = 'raw stock history patient secret';
    prismaMock.pharmacySite.findFirst.mockRejectedValueOnce(new Error(rawMessage));

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawMessage);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/pharmacy-drug-stocks/history',
        method: 'GET',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain(rawMessage);
  });
});
