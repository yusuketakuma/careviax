import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn() },
    drugMasterChangeEvent: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { GET } from './route';

function createRequest(url: string) {
  return {
    url,
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stocks/impact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.drugMasterChangeEvent.findMany.mockResolvedValue([]);
  });

  it('summarizes review, reorder, safety, and transitional expiry impact', async () => {
    const now = new Date();
    const oldReview = new Date(now);
    oldReview.setDate(oldReview.getDate() - 220);
    const soonExpiry = new Date(now);
    soonExpiry.setDate(soonExpiry.getDate() + 30);

    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        id: 'stock_1',
        drug_master_id: 'drug_1',
        reorder_point: null,
        last_reviewed_at: oldReview,
        follow_up_status: null,
        follow_up_reason: null,
        follow_up_due_date: null,
        follow_up_resolved_at: null,
        updated_at: now,
        drug_master: {
          id: 'drug_1',
          yj_code: '123456789012',
          receipt_code: null,
          drug_name: 'ハイリスク薬',
          generic_name: null,
          drug_price: 100,
          unit: '錠',
          is_generic: false,
          is_narcotic: false,
          is_psychotropic: false,
          is_high_risk: true,
          is_lasa_risk: false,
          transitional_expiry_date: soonExpiry,
        },
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stocks/impact?site_id=site_1'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      site: { id: 'site_1' },
      totals: {
        stocked_count: 1,
        review_due_count: 1,
        missing_reorder_point_count: 1,
        safety_flagged_count: 1,
        transitional_expiry_count: 1,
        action_required_count: 1,
        recent_master_change_count: 0,
      },
    });
  });
});
