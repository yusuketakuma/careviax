// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
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

type PreviewReport = {
  id: string;
  report_type: string;
  updated_at: string;
  content: unknown;
};

type QueryOptions = {
  enabled?: boolean;
  queryFn?: () => Promise<unknown>;
  queryKey?: unknown[];
};

function previewReport(overrides: Partial<PreviewReport> = {}): PreviewReport {
  return {
    id: 'report_1',
    report_type: 'physician_report',
    updated_at: REPORT_UPDATED_AT_ISO,
    content: physicianContent,
    ...overrides,
  };
}

function reportDetailResponse(reportId: string, overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: reportId,
      patient_id: 'patient_1',
      case_id: null,
      visit_record_id: null,
      report_type: 'physician_report',
      status: 'confirmed',
      content: physicianContent,
      template_id: null,
      pdf_url: null,
      created_by: 'user_1',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: REPORT_UPDATED_AT_ISO,
      delivery_records: [],
      patient_summary: null,
      visit_summary: null,
      intake_baseline_context: null,
      permissions: {
        can_edit: false,
        can_send: true,
        can_create_external_share: false,
        can_create_followup_task: false,
        can_view_patient: false,
        can_view_related_requests: false,
      },
      delivery_rule_suggestion: null,
      external_professional_suggestions: [],
      prescriber_institution_suggestion: null,
      ...overrides,
    },
  };
}

function printAuditResponse(report = previewReport(), audited = true) {
  return { data: { audited, report } };
}

function mockReportQuery(
  state: 'success' | 'loading' | 'error' | 'forbidden' = 'success',
  initialReport = previewReport(),
) {
  let currentReport = initialReport;
  useQueryMock.mockImplementation((options: QueryOptions) => {
    if (options.queryKey?.[0] !== 'care-report-print-preview') {
      throw new Error(`unexpected query scope: ${String(options.queryKey?.[0])}`);
    }
    return {
      data: state === 'success' ? currentReport : undefined,
      isLoading: state === 'loading',
      isError: state === 'error' || state === 'forbidden',
      error: state === 'forbidden' ? new Error('PRINT_FORBIDDEN') : new Error('failed'),
    };
  });
  return {
    setReport(nextReport: PreviewReport) {
      currentReport = nextReport;
    },
  };
}

function findReportQueryOptions() {
  const call = useQueryMock.mock.calls.find(
    ([options]) => (options as QueryOptions).queryKey?.[0] === 'care-report-print-preview',
  );
  return call?.[0] as QueryOptions | undefined;
}

function expectNoRawUrlControlChars(url: string, rawId: string) {
  expect(url).not.toContain(rawId);
  expect(url).not.toContain('?');
  expect(url).not.toContain('#');
  expect(url).not.toContain('%25');
}

function deferredResponse() {
  let resolveResponse: ((response: Response) => void) | undefined;
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  return {
    response,
    resolve(body: unknown, status = 200) {
      resolveResponse?.(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
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

  it('never audits or prints on ready, timer advance, reload, or remount', () => {
    mockReportQuery();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const firstRender = render(<ReportPrintPage />);
    expect(screen.getByTestId('print-layout')).toBeTruthy();
    act(() => vi.advanceTimersByTime(5_000));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(printMock).not.toHaveBeenCalled();

    firstRender.unmount();
    render(<ReportPrintPage />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(printMock).not.toHaveBeenCalled();
  });

  it('records one print_requested audit immediately before an explicit print', async () => {
    mockReportQuery();
    const fetchMock = stubJsonFetch(printAuditResponse());

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
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('preview_rendered');
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it('latches rapid duplicate print actions while the audit is pending', async () => {
    mockReportQuery();
    const deferred = deferredResponse();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(deferred.response);
    vi.stubGlobal('fetch', fetchMock);

    render(<ReportPrintPage />);
    const button = screen.getByRole('button', { name: '手動印刷' });
    fireEvent.click(button);
    fireEvent.click(button, { detail: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(printMock).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve(printAuditResponse());
      await deferred.response;
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it('blocks print when the audit request fails', async () => {
    mockReportQuery();
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

  it('blocks print when the audit response is false or malformed', async () => {
    mockReportQuery();
    const fetchMock = stubJsonFetch(printAuditResponse(previewReport(), false));

    render(<ReportPrintPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(printMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { audited: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(printMock).not.toHaveBeenCalled();
  });

  it('blocks print when the audited report version differs from the displayed version', async () => {
    mockReportQuery();
    stubJsonFetch(printAuditResponse(previewReport({ updated_at: '2026-05-12T00:05:00.000Z' })));

    render(<ReportPrintPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain(
      '印刷前に報告書が更新されました。再読み込みしてください。',
    );
    expect(printMock).not.toHaveBeenCalled();
  });

  it('invalidates a pending audit when the displayed source revision changes', async () => {
    const query = mockReportQuery();
    const deferred = deferredResponse();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockReturnValue(deferred.response));
    const view = render(<ReportPrintPage />);

    fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
    query.setReport(
      previewReport({
        updated_at: '2026-05-12T00:10:00.000Z',
        content: { ...physicianContent, assessment: '更新後の報告書' },
      }),
    );
    view.rerender(<ReportPrintPage />);

    await act(async () => {
      deferred.resolve(printAuditResponse());
      await deferred.response;
      await Promise.resolve();
    });
    expect(screen.getByText('更新後の報告書')).toBeTruthy();
    expect(printMock).not.toHaveBeenCalled();
  });

  it('invalidates a pending audit when the print page unmounts', async () => {
    mockReportQuery();
    const deferred = deferredResponse();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockReturnValue(deferred.response));
    const view = render(<ReportPrintPage />);

    fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
    view.unmount();
    await act(async () => {
      deferred.resolve(printAuditResponse());
      await deferred.response;
      await Promise.resolve();
    });
    expect(printMock).not.toHaveBeenCalled();
  });

  it('loads an exact confirmed report with GET and never posts preview_rendered', async () => {
    const hostileReportId = 'report/1?x=y#z';
    const expectedUrl = `/api/care-reports/${encodeURIComponent(hostileReportId)}`;
    useParamsMock.mockReturnValue({ id: hostileReportId });
    mockReportQuery('loading');
    const fetchMock = stubJsonFetch(reportDetailResponse(hostileReportId));

    render(<ReportPrintPage />);
    const queryOptions = findReportQueryOptions();
    expect(queryOptions?.queryKey).toEqual(['care-report-print-preview', 'org_1', hostileReportId]);
    await expect(queryOptions?.queryFn?.()).resolves.toMatchObject({ id: hostileReportId });
    expect(fetchMock).toHaveBeenCalledWith(expectedUrl, {
      headers: buildOrgHeaders('org_1'),
      cache: 'no-store',
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('preview_rendered');
    expectNoRawUrlControlChars(expectedUrl, hostileReportId);
  });

  it('fails the source query closed when can_send is false', async () => {
    mockReportQuery('loading');
    stubJsonFetch(
      reportDetailResponse('report_1', {
        permissions: {
          can_edit: true,
          can_send: false,
          can_create_external_share: false,
          can_create_followup_task: false,
          can_view_patient: false,
          can_view_related_requests: false,
        },
      }),
    );

    render(<ReportPrintPage />);
    await expect(findReportQueryOptions()?.queryFn?.()).rejects.toThrow('PRINT_FORBIDDEN');
    expect(printMock).not.toHaveBeenCalled();
  });

  it('fails the source query closed for an unconfirmed report', async () => {
    mockReportQuery('loading');
    stubJsonFetch(reportDetailResponse('report_1', { status: 'draft' }));

    render(<ReportPrintPage />);
    await expect(findReportQueryOptions()?.queryFn?.()).rejects.toThrow('PRINT_NOT_READY');
    expect(printMock).not.toHaveBeenCalled();
  });

  it('rejects a mismatched report id through the exact detail response schema', async () => {
    mockReportQuery('loading');
    stubJsonFetch(reportDetailResponse('report_other'));

    render(<ReportPrintPage />);
    await expect(findReportQueryOptions()?.queryFn?.()).rejects.toThrow(
      '報告書の印刷データを取得できませんでした',
    );
    expect(printMock).not.toHaveBeenCalled();
  });

  it.each(['.', '..'])('rejects exact dot report ids before source fetch: %s', async (reportId) => {
    useParamsMock.mockReturnValue({ id: reportId });
    mockReportQuery('loading');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    render(<ReportPrintPage />);
    await expect(findReportQueryOptions()?.queryFn?.()).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(printMock).not.toHaveBeenCalled();
  });

  it('blocks the print surface when the current role cannot send reports', () => {
    mockReportQuery('forbidden');
    render(<ReportPrintPage />);

    expect(screen.getByRole('heading', { name: '印刷権限がありません' })).toBeTruthy();
    expect(screen.queryByTestId('print-layout')).toBeNull();
    expect(screen.queryByRole('button', { name: '手動印刷' })).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(printMock).not.toHaveBeenCalled();
  });

  it('shows a data-loading skeleton without exposing report content or print controls', () => {
    mockReportQuery('loading');
    render(<ReportPrintPage />);

    expect(screen.getByRole('status', { name: '報告書の印刷データを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('佐藤 花子 様')).toBeNull();
    expect(screen.queryByText('服薬管理は安定しています')).toBeNull();
    expect(screen.queryByRole('button', { name: '手動印刷' })).toBeNull();
    expect(printMock).not.toHaveBeenCalled();
  });

  it('does not render report content when the exact source query fails', () => {
    mockReportQuery('error');
    render(<ReportPrintPage />);

    expect(screen.getByRole('heading', { name: '印刷データを取得できませんでした' })).toBeTruthy();
    expect(screen.queryByTestId('print-layout')).toBeNull();
    expect(screen.queryByText('佐藤 花子 様')).toBeNull();
    expect(printMock).not.toHaveBeenCalled();
  });

  it('renders the authorized family-share body without emitting an audit', () => {
    mockReportQuery(
      'success',
      previewReport({ report_type: 'family_share', content: familyShareContent }),
    );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    render(<ReportPrintPage />);
    expect(screen.getByRole('heading', { name: 'ご家族向け服薬情報共有' })).toBeTruthy();
    expect(screen.getByText('佐藤 花子 様')).toBeTruthy();
    expect(screen.getByText('今日の要点')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(printMock).not.toHaveBeenCalled();
  });

  it('encodes the report id for explicit audit and detail navigation', async () => {
    const hostileReportId = 'report/1?x=y#z';
    const expectedAuditUrl = `/api/care-reports/${encodeURIComponent(hostileReportId)}/print-audit`;
    const expectedBackHref = buildReportHref(hostileReportId);
    useParamsMock.mockReturnValue({ id: hostileReportId });
    mockReportQuery('success', previewReport({ id: hostileReportId }));
    const fetchMock = stubJsonFetch(printAuditResponse(previewReport({ id: hostileReportId })));

    render(<ReportPrintPage />);
    expect(screen.getByRole('link', { name: '報告書詳細へ戻る' }).getAttribute('href')).toBe(
      expectedBackHref,
    );
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
    expectNoRawUrlControlChars(expectedBackHref, hostileReportId);
    expect(printMock).toHaveBeenCalledTimes(1);
  });
});
