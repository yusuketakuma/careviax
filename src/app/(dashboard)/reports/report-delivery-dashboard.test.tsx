// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { ReportDeliveryDashboard } from './report-delivery-dashboard';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

// Actual-backed spies: real encode/guard output for hostile test, plus
// return-value delegation teeth for the overdue card patient/report links.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});
vi.mock('@/lib/reports/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/reports/navigation')>();
  return { ...actual, buildReportHref: vi.fn(actual.buildReportHref) };
});

function primeDashboard(overrides: { patientId?: string; reportId?: string } = {}) {
  const patientId = overrides.patientId ?? 'patient_1';
  const reportId = overrides.reportId ?? 'report_1';
  useOrgIdMock.mockReturnValue('org_1');
  useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
  useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useQueryMock.mockReturnValue({
    data: {
      data: {
        summary: {
          current_month: '2026-04',
          current_month_attempted_count: 3,
          current_month_success_rate: 67,
          current_month_failed_count: 1,
          current_month_confirmed_rate: 33,
          overdue_waiting_count: 1,
          overdue_threshold_days: 7,
        },
        monthly_trend: [
          {
            month: '2026-04',
            attempted_count: 3,
            success_count: 2,
            failed_count: 1,
            confirmed_count: 1,
            response_waiting_count: 1,
            success_rate: 67,
            confirmed_rate: 33,
          },
        ],
        physician_breakdown: [
          {
            recipient_name: '田中医師',
            total_count: 3,
            success_count: 2,
            confirmed_count: 1,
            success_rate: 67,
          },
        ],
        channel_breakdown: [
          { channel: 'fax', total_count: 3, success_count: 2, failed_count: 1, success_rate: 67 },
        ],
        overdue_waiting: [
          {
            id: 'delivery_1',
            report_id: reportId,
            patient_id: patientId,
            patient_name: '患者A',
            report_type: 'visit_report',
            recipient_name: '田中医師',
            recipient_contact: '03-0000-0000',
            channel: 'fax',
            sent_at: '2026-04-08T10:00:00.000Z',
            days_waiting: 8,
          },
        ],
      },
    },
    isLoading: false,
  });
}

describe('ReportDeliveryDashboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps analytics as a secondary section instead of a primary page-level link', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          summary: {
            current_month: '2026-04',
            current_month_attempted_count: 3,
            current_month_success_rate: 67,
            current_month_failed_count: 1,
            current_month_confirmed_rate: 33,
            overdue_waiting_count: 1,
            overdue_threshold_days: 7,
          },
          monthly_trend: [
            {
              month: '2026-04',
              attempted_count: 3,
              success_count: 2,
              failed_count: 1,
              confirmed_count: 1,
              response_waiting_count: 1,
              success_rate: 67,
              confirmed_rate: 33,
            },
          ],
          physician_breakdown: [
            {
              recipient_name: '田中医師',
              total_count: 3,
              success_count: 2,
              confirmed_count: 1,
              success_rate: 67,
            },
          ],
          channel_breakdown: [
            {
              channel: 'fax',
              total_count: 3,
              success_count: 2,
              failed_count: 1,
              success_rate: 67,
            },
          ],
          overdue_waiting: [
            {
              id: 'delivery_1',
              report_id: 'report_1',
              patient_id: 'patient_1',
              patient_name: '患者A',
              report_type: 'visit_report',
              recipient_name: '田中医師',
              recipient_contact: '03-0000-0000',
              channel: 'fax',
              sent_at: '2026-04-08T10:00:00.000Z',
              days_waiting: 8,
            },
          ],
        },
      },
      isLoading: false,
    });

    render(<ReportDeliveryDashboard />);

    expect(screen.getByRole('heading', { name: '送達分析・未確認フォロー' })).toBeTruthy();
    expect(
      screen.getByText(
        '一覧で対象報告を確認したあとに、送達傾向や返信待ちの滞留をまとめて見返すセクションです。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('67%')).toBeTruthy();
    expect(screen.getAllByText('2026-04').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('田中医師').length).toBeGreaterThanOrEqual(1);
    // 小集計は意味的な軽量テーブル: 各集計が region として存在し列見出し・代表セルが見える。
    expect(screen.getByRole('region', { name: '月別送達成功率' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '医師別送達' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'チャネル別送達' })).toBeTruthy();
    expect(screen.getAllByText('成功率').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('67% (2/3)').length).toBeGreaterThanOrEqual(1);
    // DataTable の検索/列切替 toolbar は小集計に不要なので持たない。
    expect(screen.queryByLabelText('月別送達成功率内検索')).toBeNull();
    expect(screen.queryByRole('button', { name: '列' })).toBeNull();
    expect(screen.getByText('患者A')).toBeTruthy();
    expect(screen.getByText('8日経過')).toBeTruthy();
    expect(screen.getByLabelText('未確認報告の超過日数')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'リマインドタスク起票' })).toBeTruthy();

    // action-first: 行動対象(未確認報告書一覧)は参照系の集計テーブルより DOM 順で前に置く。
    const overdueListTitle = screen.getByText('未確認報告書一覧');
    const monthlyTableTitle = screen.getAllByText('月別送達成功率')[0];
    expect(
      overdueListTitle.compareDocumentPosition(monthlyTableTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.queryByRole('link', { name: '送達分析ページを開く' })).toBeNull();
  });

  it('shows an error state instead of empty analytics when delivery analytics fail to load', () => {
    const refetch = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<ReportDeliveryDashboard />);

    expect(screen.getByRole('heading', { name: '送達分析を表示できません' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    expect(screen.queryByText('送達データがありません')).toBeNull();
    expect(screen.queryByText('7日超の未確認報告はありません。')).toBeNull();
    expect(screen.queryByRole('button', { name: 'リマインドタスク起票' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('describes the reminder action while analytics are loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<ReportDeliveryDashboard />);

    const reminderButton = screen.getByRole('button', { name: 'リマインドタスク起票' });
    const reminderReason = screen.getByText('送達分析を読み込んでいます。');

    expect(reminderButton).toHaveProperty('disabled', true);
    expect(reminderButton.getAttribute('aria-describedby')).toBe(reminderReason.id);
    expect(reminderReason.textContent).not.toMatch(/patient_|report_|山田|田中|患者A/);
  });

  it('fetches delivery analytics with the org-header helper and stable query key', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    primeDashboard();

    render(<ReportDeliveryDashboard />);

    const queryOptions = useQueryMock.mock.calls[0]?.[0] as {
      queryKey: unknown[];
      queryFn: () => Promise<unknown>;
    };
    expect(queryOptions.queryKey).toEqual(['care-report-analytics', 'org_1', 7]);

    await queryOptions.queryFn();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/care-reports/analytics?overdue_days=7');
    expect(init.headers).toBe(sentinelHeaders);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
  });

  it('queues delivery reminders with json org headers and the exact payload', async () => {
    const sentinelHeaders = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { queued_count: 2 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    primeDashboard();

    render(<ReportDeliveryDashboard />);

    const mutationOptions = useMutationMock.mock.calls[0]?.[0] as {
      mutationFn: () => Promise<{ data: { queued_count: number } }>;
    };

    await expect(mutationOptions.mutationFn()).resolves.toEqual({ data: { queued_count: 2 } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/care-reports/reminders');
    expect(init.method).toBe('POST');
    expect(init.headers).toBe(sentinelHeaders);
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    expect(init.body).toBe(JSON.stringify({ overdue_days: 7 }));
  });

  describe('shared href helper convergence (F-044)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('overdue card patient/report links consume the shared helper return values', () => {
      primeDashboard();
      const realPatient = vi.mocked(buildPatientHref).getMockImplementation();
      const realReport = vi.mocked(buildReportHref).getMockImplementation();
      vi.mocked(buildPatientHref).mockImplementation((id: string) => `/patients/__s_${id}__`);
      vi.mocked(buildReportHref).mockImplementation((id: string) => `/reports/__s_${id}__`);
      try {
        render(<ReportDeliveryDashboard />);

        expect(screen.getByRole('link', { name: '患者詳細' }).getAttribute('href')).toBe(
          '/patients/__s_patient_1__',
        );
        expect(screen.getByRole('link', { name: '報告書を開く' }).getAttribute('href')).toBe(
          '/reports/__s_report_1__',
        );
        expect(vi.mocked(buildPatientHref).mock.calls).toEqual([['patient_1']]);
        expect(vi.mocked(buildReportHref).mock.calls).toEqual([['report_1']]);
      } finally {
        if (realPatient) vi.mocked(buildPatientHref).mockImplementation(realPatient);
        if (realReport) vi.mocked(buildReportHref).mockImplementation(realReport);
      }
    });

    it('encodes hostile patient/report ids as single path segments', () => {
      primeDashboard({ patientId: 'pt/1?x=y#z', reportId: 'report/1?x=y#z' });
      render(<ReportDeliveryDashboard />);

      expect(screen.getByRole('link', { name: '患者詳細' }).getAttribute('href')).toBe(
        `/patients/${encodeURIComponent('pt/1?x=y#z')}`,
      );
      expect(screen.getByRole('link', { name: '報告書を開く' }).getAttribute('href')).toBe(
        `/reports/${encodeURIComponent('report/1?x=y#z')}`,
      );
      for (const name of ['患者詳細', '報告書を開く']) {
        const href = screen.getByRole('link', { name }).getAttribute('href') ?? '';
        expect(href).not.toContain('?x=y');
        expect(href).not.toContain('#z');
      }
    });
  });
});
