import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthContextMock, withOrgContextMock, previewOverloadRebalanceMock } = vi.hoisted(
  () => ({
    withAuthContextMock: vi.fn(
      (
        handler: (
          req: NextRequest,
          ctx: { orgId: string; userId: string; role: 'pharmacist' },
          routeContext: { params: Promise<Record<string, string>> },
        ) => Promise<Response>,
        _options?: unknown,
      ) => {
        void _options;
        return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
          handler(
            req,
            {
              orgId: 'org_1',
              userId: 'user_1',
              role: 'pharmacist',
            },
            routeContext,
          );
      },
    ),
    withOrgContextMock: vi.fn(),
    previewOverloadRebalanceMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/visit-schedule-overload-rebalancer', async () => {
  const actual = await vi.importActual<
    typeof import('@/server/services/visit-schedule-overload-rebalancer')
  >('@/server/services/visit-schedule-overload-rebalancer');
  return {
    ...actual,
    previewVisitScheduleOverloadRebalance: previewOverloadRebalanceMock,
  };
});

import { POST } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const emptyRouteContext = { params: Promise.resolve({}) };
const withAuthRegistrationCalls = [...withAuthContextMock.mock.calls];

function createPostRequest(body: unknown) {
  return new NextRequest(
    'http://localhost/api/visit-schedule-proposals/overload-rebalance-preview',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

function createMalformedJsonPostRequest() {
  return new NextRequest(
    'http://localhost/api/visit-schedule-proposals/overload-rebalance-preview',
    {
      method: 'POST',
      body: '{"date_from":',
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('/api/visit-schedule-proposals/overload-rebalance-preview POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitScheduleProposal: { findMany: vi.fn() },
        visitSchedule: { findMany: vi.fn() },
        user: { findMany: vi.fn() },
      }),
    );
    previewOverloadRebalanceMock.mockResolvedValue({
      overloaded_cells: [
        {
          proposed_pharmacist_id: 'pharmacist_1',
          proposed_date: '2026-04-10',
          occupancy_count: 4,
          max_daily_visits: 3,
          eligible_proposal_count: 2,
        },
      ],
      previews: [
        {
          source_proposal_id: 'proposal_1',
          reason_code: 'overload_advance',
          from: {
            proposed_date: '2026-04-10',
            proposed_pharmacist_id: 'pharmacist_1',
            route_order: 2,
            occupancy_count: 4,
            max_daily_visits: 3,
          },
          replacement: {
            case_id: 'case_1',
            site_id: 'site_1',
            visit_type: 'regular',
            priority: 'normal',
            proposed_date: new Date('2026-04-08T00:00:00.000Z'),
            time_window_start: new Date('1970-01-01T09:00:00.000Z'),
            time_window_end: new Date('1970-01-01T10:00:00.000Z'),
            proposed_pharmacist_id: 'pharmacist_1',
            route_order: 1,
            vehicle_resource_id: 'vehicle_1',
            visit_deadline_date: new Date('2026-04-10T00:00:00.000Z'),
          },
          diagnostics: {
            destination_date: '2026-04-08',
            destination_occupancy_count: 0,
            destination_max_daily_visits: 3,
          },
        },
      ],
      skipped: [{ source_proposal_id: 'proposal_skip_secret', reason_code: 'not_mutable' }],
    });
  });

  it('registers the route with canVisit permission', () => {
    expect(withAuthRegistrationCalls[0]?.[1]).toMatchObject({
      permission: 'canVisit',
      message: '訪問候補の過密前倒しプレビュー権限がありません',
    });
  });

  it('returns no-store overload rebalance preview data via org-scoped service execution', async () => {
    const response = await POST(
      createPostRequest({
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        search_start_date: '2026-04-05',
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
    });
    expect(previewOverloadRebalanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        dateFrom: new Date('2026-04-01T00:00:00.000Z'),
        dateTo: new Date('2026-04-30T00:00:00.000Z'),
        searchStartDate: new Date('2026-04-05T00:00:00.000Z'),
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        preview_only: true,
        apply_available: false,
        unsupported_guards: [
          'pharmacist_review_required',
          'vehicle_open_proposal_capacity',
          'billing_cap_recheck',
        ],
        overloaded_cells: [
          {
            pharmacist_id: 'pharmacist_1',
            date: '2026-04-10',
            capacity_limit: 3,
            over_by: 1,
          },
        ],
        recommendations: [
          {
            source_proposal_id: 'proposal_1',
            reason_code: 'overload_advance',
            replacement: {
              date: '2026-04-08',
              time_window_start: '09:00',
              time_window_end: '10:00',
            },
          },
        ],
        skipped_summary: [
          { reason_code: 'not_mutable', count: 1 },
          { reason_code: 'no_earlier_candidate', count: 0 },
          { reason_code: 'destination_capacity_full', count: 0 },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain('case_1');
    expect(JSON.stringify(body)).not.toContain('proposal_skip_secret');
    expect(JSON.stringify(body)).not.toContain('destination_occupancy_count');
  });

  it('rejects malformed JSON before opening org context', async () => {
    const response = await POST(createMalformedJsonPostRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(previewOverloadRebalanceMock).not.toHaveBeenCalled();
  });

  it('rejects invalid date ranges before opening org context', async () => {
    const response = await POST(
      createPostRequest({ date_from: '2026-04-30', date_to: '2026-04-01' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'date_to は date_from 以降の日付を指定してください',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(previewOverloadRebalanceMock).not.toHaveBeenCalled();
  });

  it('rejects overly broad preview ranges before opening org context', async () => {
    const response = await POST(
      createPostRequest({ date_from: '2026-04-01', date_to: '2026-07-01' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '過密前倒しプレビューの対象期間が長すぎます',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(previewOverloadRebalanceMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw service failures', async () => {
    previewOverloadRebalanceMock.mockRejectedValueOnce(
      new Error('PHI leak candidate: patient 山田太郎 overload failed'),
    );

    const response = await POST(
      createPostRequest({ date_from: '2026-04-01', date_to: '2026-04-30' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('PHI leak candidate');
    expect(body).not.toContain('山田太郎');
  });
});
