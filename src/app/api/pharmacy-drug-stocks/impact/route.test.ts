import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { count: vi.fn(), findMany: vi.fn() },
    drugMasterChangeEvent: { findMany: vi.fn() },
    qrScanDraft: { findMany: vi.fn() },
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
    prismaMock.qrScanDraft.findMany.mockResolvedValue([]);
  });

  it('summarizes review, reorder, safety, and transitional expiry impact', async () => {
    const now = new Date();
    const oldReview = new Date(now);
    oldReview.setDate(oldReview.getDate() - 220);
    const soonExpiry = new Date(now);
    soonExpiry.setDate(soonExpiry.getDate() + 30);

    const stock = {
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
    };
    prismaMock.pharmacyDrugStock.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    prismaMock.pharmacyDrugStock.findMany
      .mockResolvedValueOnce([stock])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([stock])
      .mockResolvedValueOnce([stock])
      .mockResolvedValueOnce([stock])
      .mockResolvedValueOnce([stock])
      .mockResolvedValueOnce([stock])
      .mockResolvedValueOnce([]);

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stocks/impact?site_id=site_1'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      site: { id: 'site_1' },
      selected_queue: {
        key: 'action_required',
        total_count: 1,
      },
      totals: {
        stocked_count: 1,
        review_due_count: 1,
        missing_reorder_point_count: 1,
        safety_flagged_count: 1,
        transitional_expiry_count: 1,
        transitional_expiry_within_30_count: 1,
        transitional_expiry_within_60_count: 1,
        transitional_expiry_within_90_count: 1,
        action_required_count: 1,
        recent_master_change_count: 0,
      },
      master_change_report: {
        total_count: 0,
        sampled_count: 0,
        is_truncated: false,
        change_type_counts: [],
      },
    });
  });

  it('returns recently changed adopted drugs and excludes resolved follow-ups from action-required', async () => {
    const now = new Date();
    const changedAt = new Date(now);
    changedAt.setDate(changedAt.getDate() - 3);
    const futureReview = new Date(now);
    futureReview.setDate(futureReview.getDate() + 10);

    const changedStock = {
      id: 'stock_changed',
      drug_master_id: 'drug_changed',
      reorder_point: 10,
      last_reviewed_at: futureReview,
      follow_up_status: 'resolved',
      follow_up_reason: '切替済み',
      follow_up_due_date: null,
      follow_up_resolved_at: now,
      updated_at: now,
      drug_master: {
        id: 'drug_changed',
        yj_code: '123456789012',
        receipt_code: null,
        drug_name: '改定薬',
        generic_name: null,
        drug_price: 120,
        unit: '錠',
        is_generic: false,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        transitional_expiry_date: null,
      },
    };
    const change = {
      id: 'change_1',
      yj_code: '123456789012',
      change_type: 'price_changed',
      previous_value: { drug_price: '100.00' },
      current_value: { drug_price: '120.00' },
      created_at: changedAt,
    };
    prismaMock.drugMasterChangeEvent.findMany
      .mockResolvedValueOnce([{ yj_code: '123456789012' }])
      .mockResolvedValueOnce([change]);
    prismaMock.pharmacyDrugStock.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    prismaMock.pharmacyDrugStock.findMany
      .mockResolvedValueOnce([changedStock])
      .mockResolvedValueOnce([changedStock])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([changedStock]);
    prismaMock.qrScanDraft.findMany.mockResolvedValue([
      {
        parsed_data: {
          medications: [
            { drugCode: '123456789012', drugName: '改定薬' },
            { drugCode: '123456789012', drugName: '改定薬' },
          ],
        },
      },
    ]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/impact?site_id=site_1&queue=recently_changed&queue_limit=1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      selected_queue: {
        key: 'recently_changed',
        total_count: 1,
        rows: [
          {
            id: 'stock_changed',
            drug_master: { yj_code: '123456789012', drug_name: '改定薬' },
          },
        ],
      },
      totals: {
        stocked_count: 2,
        action_required_count: 0,
        recent_master_change_count: 1,
      },
      recent_changes: [
        {
          yj_code: '123456789012',
          change_type: 'price_changed',
        },
      ],
      master_change_report: {
        total_count: 1,
        sampled_count: 1,
        is_truncated: false,
        change_type_counts: [{ change_type: 'price_changed', count: 1 }],
        rows: [
          {
            stock: { id: 'stock_changed' },
            changes: [{ yj_code: '123456789012', change_type: 'price_changed' }],
          },
        ],
        price_impact: {
          scanned_draft_count: 1,
          estimated_total_delta: 40,
          rows: [
            {
              stock: { id: 'stock_changed' },
              previous_price: 100,
              current_price: 120,
              unit_price_delta: 20,
              usage_count: 2,
              estimated_total_delta: 40,
            },
          ],
        },
      },
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

  it('does not cap impact totals to the first 500 adopted drugs', async () => {
    const now = new Date();
    const oldReview = new Date(now);
    oldReview.setDate(oldReview.getDate() - 220);

    const stocks = Array.from({ length: 25 }, (_, index) => ({
      id: `stock_${index}`,
      drug_master_id: `drug_${index}`,
      reorder_point: 1,
      last_reviewed_at: oldReview,
      follow_up_status: null,
      follow_up_reason: null,
      follow_up_due_date: null,
      follow_up_resolved_at: null,
      updated_at: now,
      drug_master: {
        id: `drug_${index}`,
        yj_code: `123456789${index.toString().padStart(3, '0')}`,
        receipt_code: null,
        drug_name: `採用薬${index}`,
        generic_name: null,
        drug_price: 100,
        unit: '錠',
        is_generic: false,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        transitional_expiry_date: null,
      },
    }));
    prismaMock.pharmacyDrugStock.count
      .mockResolvedValueOnce(501)
      .mockResolvedValueOnce(501)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.pharmacyDrugStock.findMany
      .mockResolvedValueOnce(stocks)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(stocks.slice(0, 10))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/impact?site_id=site_1&queue=review_due&queue_limit=25',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
    const json = await response.json();
    expect(json.selected_queue.key).toBe('review_due');
    expect(json.selected_queue.total_count).toBe(501);
    expect(json.selected_queue.rows).toHaveLength(25);
    expect(json.selected_queue.rows[0]).toMatchObject({ id: 'stock_0' });
    expect(json.totals).toMatchObject({
      stocked_count: 501,
      review_due_count: 501,
    });
  });
});
