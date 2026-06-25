import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, getCareReportDeliveryAnalyticsMock, withOrgContextMock } =
  vi.hoisted(() => ({
    requireAuthContextMock: vi.fn(),
    getCareReportDeliveryAnalyticsMock: vi.fn(),
    withOrgContextMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/report-reminders', () => ({
  getCareReportDeliveryAnalytics: getCareReportDeliveryAnalyticsMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET } from './route';

function createRequest(url = 'http://localhost/api/care-reports/analytics') {
  return new NextRequest(url);
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/care-reports/analytics GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    withOrgContextMock.mockImplementation((_orgId, callback) =>
      callback({ __scopedTx: true } as never),
    );
    getCareReportDeliveryAnalyticsMock.mockResolvedValue({
      summary: {
        current_month: '2026-03',
        current_month_attempted_count: 4,
        current_month_success_rate: 75,
        current_month_failed_count: 1,
        current_month_confirmed_rate: 50,
        overdue_waiting_count: 2,
        overdue_threshold_days: 7,
      },
      monthly_trend: [],
      physician_breakdown: [],
      channel_breakdown: [],
      overdue_waiting: [],
    });
  });

  it('returns report delivery analytics with threshold parsing', async () => {
    const response = await GET(
      createRequest('http://localhost/api/care-reports/analytics?overdue_days=10'),
    );

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(200);
    expectSensitiveNoStore(ensuredResponse);
    expect(getCareReportDeliveryAnalyticsMock).toHaveBeenCalledWith(
      'org_1',
      {
        overdueDays: 10,
      },
      { __scopedTx: true },
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canSendCareReport',
      message: '報告書分析の閲覧権限がありません',
    });
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      data: {
        summary: {
          overdue_threshold_days: 7,
        },
      },
    });
  });

  it('rejects malformed overdue day values before loading analytics', async () => {
    const response = await GET(
      createRequest('http://localhost/api/care-reports/analytics?overdue_days=1e1'),
    );

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(400);
    expectSensitiveNoStore(ensuredResponse);
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        overdue_days: ['overdue_days は整数で指定してください'],
      },
    });
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'padded overdue_days',
      'http://localhost/api/care-reports/analytics?overdue_days=%2010%20',
      { overdue_days: ['overdue_days は整数で指定してください'] },
    ],
    [
      'duplicate overdue_days',
      'http://localhost/api/care-reports/analytics?overdue_days=7&overdue_days=10',
      { overdue_days: ['overdue_days は1つだけ指定してください'] },
    ],
  ])('rejects %s before loading analytics', async (_name, url, details) => {
    const response = await GET(createRequest(url));

    const ensuredResponse = response;
    if (!ensuredResponse) throw new Error('response is required');
    expect(ensuredResponse.status).toBe(400);
    expectSensitiveNoStore(ensuredResponse);
    await expect(ensuredResponse.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details,
    });
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('requires care report send permission before loading delivery contacts', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'FORBIDDEN', message: '報告書分析の閲覧権限がありません' }),
        { status: 403 },
      ),
    });

    const response = await GET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(getCareReportDeliveryAnalyticsMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 envelope when analytics loading throws', async () => {
    getCareReportDeliveryAnalyticsMock.mockRejectedValueOnce(
      new Error('raw physician analytics failure'),
    );

    const response = await GET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const payload = await response.json();
    expect(payload).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(payload)).not.toContain('raw physician analytics failure');
  });
});
