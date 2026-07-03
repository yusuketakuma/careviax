// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildReportHref } from '@/lib/reports/navigation';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { stubJsonFetch } from '@/test/fetch-test-utils';
import ReportPrintPage from './page';

const printMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn(() => ({ id: 'report_1' })));

vi.mock('next/navigation', () => ({
  useParams: useParamsMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/components/features/reports/print-layout', () => ({
  PrintLayout: ({ children }: { children: ReactNode }) => (
    <main data-testid="print-layout">{children}</main>
  ),
}));

vi.mock('@/components/features/workflow/print-page-toolbar', () => ({
  PrintPageToolbar: ({
    backHref,
    backLabel,
    title,
    onPrint,
  }: {
    backHref: string;
    backLabel: string;
    title: string;
    onPrint?: () => void | Promise<void>;
  }) => (
    <header>
      <a href={backHref}>{backLabel}</a>
      <span>{title}</span>
      {onPrint ? (
        <button
          type="button"
          onClick={() => {
            void onPrint();
          }}
        >
          手動印刷
        </button>
      ) : null}
    </header>
  ),
}));

setupDomTestEnv();

const physicianContent = {
  patient: { name: '佐藤 花子', birth_date: '1940-01-01', gender: 'female' },
  report_date: '2026-05-12',
  visit_date: '2026-03-29',
  pharmacist_name: '薬剤師 太郎',
  prescriber: { name: '山田 太郎', institution: '青葉内科' },
  prescriptions: [],
  medication_management: {
    compliance_summary: 'カレンダー管理で概ね服薬できています',
    adherence_score: 4,
    self_management: '家族確認あり',
    calendar_used: true,
  },
  adverse_events: { has_events: false, events: [] },
  functional_assessment: {
    lab_values: '未確認',
    sleep: '良好',
    cognition: '変化なし',
    diet_oral: '摂取良好',
    mobility: '屋内歩行可能',
    excretion: '問題なし',
  },
  residual_medications: [],
  assessment: '服薬管理は安定しています',
  plan: '次回訪問で残薬を再確認します',
  physician_communication: '処方継続で問題ありません',
  warnings: [],
};

const familyShareContent = {
  report_audience: 'family',
  patient: { name: '佐藤 花子', birth_date: '1940-01-01' },
  report_date: '2026-05-12',
  visit_date: '2026-03-29',
  pharmacist_name: '薬剤師 太郎',
  summary: '今日の要点',
  medication: '服薬状況',
  residual: '残薬なし',
  evaluation: '安定',
  requests: '継続確認',
  warnings: [],
};

const REPORT_UPDATED_AT_ISO = '2026-05-12T00:00:00.000Z';

function mockReportQueries(
  auditState: 'success' | 'loading' | 'error' | 'forbidden' = 'success',
  reportOverride: Partial<{
    id: string;
    report_type: string;
    updated_at: string;
    pharmacy_name: string;
    content: unknown;
  }> = {},
) {
  useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
    const queryScope = options.queryKey?.[0];
    if (queryScope === 'care-report-print-audit') {
      return {
        data:
          auditState === 'success'
            ? {
                data: {
                  audited: true,
                  report: {
                    id: 'report_1',
                    report_type: 'physician_report',
                    updated_at: REPORT_UPDATED_AT_ISO,
                    pharmacy_name: '青葉薬局',
                    content: physicianContent,
                    ...reportOverride,
                  },
                },
              }
            : undefined,
        isLoading: auditState === 'loading',
        isError: auditState === 'error' || auditState === 'forbidden',
        isSuccess: auditState === 'success',
        error: auditState === 'forbidden' ? new Error('PRINT_FORBIDDEN') : new Error('failed'),
      };
    }

    throw new Error(`unexpected query scope: ${String(queryScope)}`);
  });
}

function findPrintAuditQueryOptions() {
  const call = useQueryMock.mock.calls.find(
    ([options]) =>
      (options as { queryKey?: unknown[] }).queryKey?.[0] === 'care-report-print-audit',
  );
  return call?.[0] as
    | { enabled?: boolean; queryFn?: () => Promise<unknown>; queryKey?: unknown[] }
    | undefined;
}

function expectNoRawUrlControlChars(url: string, rawId: string) {
  expect(url).not.toContain(rawId);
  expect(url).not.toContain('?');
  expect(url).not.toContain('#');
  expect(url).not.toContain('%25');
}

describe('ReportPrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useParamsMock.mockReturnValue({ id: 'report_1' });
    vi.useFakeTimers();
    vi.stubGlobal('print', printMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('auto-prints after recording a print-requested audit for an authorized report', async () => {
    mockReportQueries();
    const fetchMock = stubJsonFetch({
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: physicianContent,
        },
      },
    });

    render(<ReportPrintPage />);

    expect(screen.getByTestId('print-layout')).toBeTruthy();
    expect(printMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({
        intent: 'print_requested',
        expected_report_updated_at: REPORT_UPDATED_AT_ISO,
      }),
    });
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it('blocks direct print URLs when the role cannot send reports', () => {
    mockReportQueries('forbidden');

    render(<ReportPrintPage />);

    expect(screen.getByRole('heading', { name: '印刷権限がありません' })).toBeTruthy();
    expect(screen.queryByTestId('print-layout')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(printMock).not.toHaveBeenCalled();
    expect(findPrintAuditQueryOptions()?.enabled).toBe(true);
  });

  it('posts the print audit request for authorized print URLs', async () => {
    mockReportQueries();
    const fetchMock = stubJsonFetch({
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: physicianContent,
        },
      },
    });

    render(<ReportPrintPage />);

    const printAuditQueryOptions = findPrintAuditQueryOptions();
    expect(printAuditQueryOptions?.enabled).toBe(true);
    expect(printAuditQueryOptions?.queryKey).toEqual([
      'care-report-print-audit',
      'org_1',
      'report_1',
      expect.any(String),
    ]);
    await expect(printAuditQueryOptions?.queryFn?.()).resolves.toMatchObject({
      data: { audited: true, report: { id: 'report_1' } },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({ intent: 'preview_rendered' }),
    });
  });

  it('encodes hostile report ids only in the preview print-audit URL', async () => {
    const hostileReportId = 'report/1?x=y#z';
    const expectedUrl = `/api/care-reports/${encodeURIComponent(hostileReportId)}/print-audit`;
    useParamsMock.mockReturnValue({ id: hostileReportId });
    mockReportQueries('success', { id: hostileReportId });
    const fetchMock = stubJsonFetch({
      data: {
        audited: true,
        report: {
          id: hostileReportId,
          report_type: 'physician_report',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: physicianContent,
        },
      },
    });

    render(<ReportPrintPage />);

    const printAuditQueryOptions = findPrintAuditQueryOptions();
    expect(printAuditQueryOptions?.queryKey).toEqual([
      'care-report-print-audit',
      'org_1',
      hostileReportId,
      expect.any(String),
    ]);
    await expect(printAuditQueryOptions?.queryFn?.()).resolves.toMatchObject({
      data: { audited: true, report: { id: hostileReportId } },
    });
    expect(fetchMock).toHaveBeenCalledWith(expectedUrl, {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({ intent: 'preview_rendered' }),
    });
    expectNoRawUrlControlChars(expectedUrl, hostileReportId);
  });

  it('records a fresh print audit before manual print actions', async () => {
    mockReportQueries();
    const fetchMock = stubJsonFetch({
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: physicianContent,
        },
      },
    });

    render(<ReportPrintPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({
        intent: 'print_requested',
        expected_report_updated_at: REPORT_UPDATED_AT_ISO,
      }),
    });
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it('encodes hostile report ids for manual print audits and the detail back link', async () => {
    const hostileReportId = 'report/1?x=y#z';
    const expectedAuditUrl = `/api/care-reports/${encodeURIComponent(hostileReportId)}/print-audit`;
    const expectedBackHref = buildReportHref(hostileReportId);
    useParamsMock.mockReturnValue({ id: hostileReportId });
    mockReportQueries('success', { id: hostileReportId });
    const fetchMock = stubJsonFetch({
      data: {
        audited: true,
        report: {
          id: hostileReportId,
          report_type: 'physician_report',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: physicianContent,
        },
      },
    });

    render(<ReportPrintPage />);

    const backLink = screen.getByRole('link', { name: '報告書詳細へ戻る' });
    expect(backLink.getAttribute('href')).toBe(expectedBackHref);
    expectNoRawUrlControlChars(expectedBackHref, hostileReportId);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(expectedAuditUrl, {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({
        intent: 'print_requested',
        expected_report_updated_at: REPORT_UPDATED_AT_ISO,
      }),
    });
    expectNoRawUrlControlChars(expectedAuditUrl, hostileReportId);
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it('blocks manual print when a fresh print audit cannot be recorded', async () => {
    mockReportQueries();
    stubJsonFetch({ code: 'PRINT_AUDIT_FAILED' }, 500);

    render(<ReportPrintPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain(
      '印刷監査を記録できないため、再印刷できません。',
    );
    expect(printMock).not.toHaveBeenCalled();
  });

  it('blocks manual print when a fresh print audit response is not audited', async () => {
    mockReportQueries();
    stubJsonFetch({
      data: {
        audited: false,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          content: physicianContent,
        },
      },
    });

    render(<ReportPrintPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain(
      '印刷監査を記録できないため、再印刷できません。',
    );
    expect(printMock).not.toHaveBeenCalled();
  });

  it('blocks manual print when a fresh print audit success response is malformed', async () => {
    mockReportQueries();
    stubJsonFetch({ data: { audited: true } });

    render(<ReportPrintPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain(
      '印刷監査を記録できないため、再印刷できません。',
    );
    expect(printMock).not.toHaveBeenCalled();
  });

  it('blocks manual print when the fresh print audit response is for another report', async () => {
    mockReportQueries();
    stubJsonFetch({
      data: {
        audited: true,
        report: {
          id: 'report_other',
          report_type: 'physician_report',
          content: physicianContent,
        },
      },
    });

    render(<ReportPrintPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain(
      '印刷監査を記録できないため、再印刷できません。',
    );
    expect(printMock).not.toHaveBeenCalled();
  });

  it('blocks manual print when the report changed after preview audit', async () => {
    mockReportQueries();
    const fetchMock = stubJsonFetch({
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          updated_at: '2026-05-12T00:05:00.000Z',
          content: physicianContent,
        },
      },
    });

    render(<ReportPrintPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({
        intent: 'print_requested',
        expected_report_updated_at: REPORT_UPDATED_AT_ISO,
      }),
    });
    expect(screen.getByRole('alert').textContent).toContain(
      '印刷前に報告書が更新されました。再読み込みしてください。',
    );
    expect(printMock).not.toHaveBeenCalled();
  });

  it('uses a fresh print audit query key for each direct print page mount', () => {
    mockReportQueries();
    const firstRender = render(<ReportPrintPage />);
    const firstKey = findPrintAuditQueryOptions()?.queryKey;
    expect(firstKey).toEqual(['care-report-print-audit', 'org_1', 'report_1', expect.any(String)]);

    firstRender.unmount();
    vi.clearAllMocks();
    mockReportQueries();
    render(<ReportPrintPage />);

    const secondKey = findPrintAuditQueryOptions()?.queryKey;
    expect(secondKey).toEqual(['care-report-print-audit', 'org_1', 'report_1', expect.any(String)]);
    expect(secondKey?.[3]).not.toBe(firstKey?.[3]);
  });

  it('does not render or print while the print audit is still being recorded', () => {
    mockReportQueries('loading');

    render(<ReportPrintPage />);

    expect(screen.getByText('印刷監査を記録中...')).toBeTruthy();
    expect(screen.queryByTestId('print-layout')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(printMock).not.toHaveBeenCalled();
  });

  it('renders family share print bodies through the audited print response', () => {
    mockReportQueries('success', {
      report_type: 'family_share',
      content: familyShareContent,
    });

    render(<ReportPrintPage />);

    expect(screen.getByTestId('print-layout')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ご家族向け服薬情報共有' })).toBeTruthy();
    expect(screen.getByText('佐藤 花子 様')).toBeTruthy();
    expect(screen.getByText('今日の要点')).toBeTruthy();
    expect(screen.getByText('服薬状況')).toBeTruthy();
    expect(screen.getByText('継続確認')).toBeTruthy();
  });

  it('does not render or print when the print audit fails', () => {
    mockReportQueries('error');

    render(<ReportPrintPage />);

    expect(screen.getByRole('heading', { name: '印刷監査を記録できませんでした' })).toBeTruthy();
    expect(screen.queryByTestId('print-layout')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(printMock).not.toHaveBeenCalled();
  });

  it('does not render or print when the preview audit response is for another report', () => {
    mockReportQueries('success', {
      id: 'report_other',
      content: { ...physicianContent, assessment: '別報告書として返された監査本文' },
    });

    render(<ReportPrintPage />);

    expect(screen.getByRole('heading', { name: '印刷監査を記録できませんでした' })).toBeTruthy();
    expect(screen.queryByTestId('print-layout')).toBeNull();
    expect(screen.queryByText('別報告書として返された監査本文')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(printMock).not.toHaveBeenCalled();
  });

  it.each(['.', '..'])(
    'rejects preview print-audit query before fetch for exact dot report id %s',
    async (reportId) => {
      useParamsMock.mockReturnValue({ id: reportId });
      mockReportQueries('loading');
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      render(<ReportPrintPage />);

      const printAuditQueryOptions = findPrintAuditQueryOptions();
      expect(printAuditQueryOptions?.queryKey).toEqual([
        'care-report-print-audit',
        'org_1',
        reportId,
        expect.any(String),
      ]);
      await expect(printAuditQueryOptions?.queryFn?.()).rejects.toThrow(RangeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['.', '..'])(
    'fails closed before rendering manual print controls for exact dot report id %s',
    (reportId) => {
      useParamsMock.mockReturnValue({ id: reportId });
      mockReportQueries('success', { id: reportId });
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        expect(() => render(<ReportPrintPage />)).toThrow(RangeError);
      } finally {
        consoleErrorSpy.mockRestore();
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(printMock).not.toHaveBeenCalled();
    },
  );
});
