import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn(), updateMany: vi.fn() },
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
  return new NextRequest('http://localhost/api/pharmacy-drug-stocks/review', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pharmacy-drug-stocks/review', {
    method: 'POST',
    body: '{"site_id":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/pharmacy-drug-stocks/review', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
  });

  it('marks scoped stocked drugs as reviewed and writes an audit log', async () => {
    const reviewedAt = new Date('2026-04-09T03:04:05.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(reviewedAt);
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      { id: 'stock_1', drug_master_id: 'drug_1' },
      { id: 'stock_2', drug_master_id: 'drug_2' },
    ]);
    prismaMock.pharmacyDrugStock.updateMany.mockResolvedValue({ count: 2 });

    const response = await POST(
      createRequest({
        site_id: 'site_1',
        drug_master_ids: ['drug_1', 'drug_2'],
      }),
      {
        params: Promise.resolve({}),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prismaMock.pharmacySite.findFirst).toHaveBeenCalledWith({
      where: { id: 'site_1', org_id: 'org_1' },
      select: { id: true, name: true },
    });
    expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        site_id: 'site_1',
        is_stocked: true,
        drug_master_id: { in: ['drug_1', 'drug_2'] },
      },
      select: { id: true, drug_master_id: true },
      take: 1000,
    });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(prismaMock.pharmacyDrugStock.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['stock_1', 'stock_2'] },
        org_id: 'org_1',
      },
      data: {
        last_reviewed_at: reviewedAt,
        reviewed_by_id: 'user_1',
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_1',
        actor_site_id: undefined,
        patient_id: undefined,
        action: 'pharmacy_drug_stock_reviewed',
        target_type: 'PharmacySite',
        target_id: 'site_1',
        changes: {
          site_id: 'site_1',
          reviewed_count: 2,
          drug_master_ids: ['drug_1', 'drug_2'],
        },
        ip_address: undefined,
        user_agent: undefined,
      },
    });
    await expect(response.json()).resolves.toEqual({
      site: { id: 'site_1', name: '本店' },
      reviewedCount: 2,
      reviewedAt: '2026-04-09T03:04:05.000Z',
    });
  });

  it('returns a no-op success when no stocked drugs match the review scope', async () => {
    const response = await POST(createRequest({ site_id: 'site_1' }), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        site_id: 'site_1',
        is_stocked: true,
      },
      select: { id: true, drug_master_id: true },
      take: 1000,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      site: { id: 'site_1', name: '本店' },
      reviewedCount: 0,
    });
  });

  it('returns not found when the requested site is outside the organization', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await POST(createRequest({ site_id: 'site_other' }), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '対象の薬局拠点が見つかりません',
    });
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid site and oversized drug-master filters before DB reads', async () => {
    const response = await POST(
      createRequest({
        site_id: ' ',
        drug_master_ids: Array.from({ length: 1001 }, (_, index) => `drug_${index}`),
      }),
      {
        params: Promise.resolve({}),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        site_id: expect.any(Array),
        drug_master_ids: expect.any(Array),
      },
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before looking up the site', async () => {
    const response = await POST(createRequest(['unexpected']), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before looking up the site', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
