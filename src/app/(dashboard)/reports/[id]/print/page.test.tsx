// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import ReportPrintPage from './page';

const printMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'report_1' }),
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
    title,
    onPrint,
  }: {
    title: string;
    onPrint?: () => void | Promise<void>;
  }) => (
    <header>
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
    lab_values: null,
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
};

function mockReportQueries(auditState: 'success' | 'loading' | 'error' | 'forbidden' = 'success') {
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
                    pharmacy_name: '青葉薬局',
                    content: physicianContent,
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

describe('ReportPrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('print', printMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('auto-prints after recording a print-requested audit for an authorized report', async () => {
    mockReportQueries();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            audited: true,
            report: {
              id: 'report_1',
              report_type: 'physician_report',
              content: physicianContent,
            },
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

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
      headers: {
        'content-type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({ intent: 'print_requested' }),
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            audited: true,
            report: {
              id: 'report_1',
              report_type: 'physician_report',
              content: physicianContent,
            },
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

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
      headers: {
        'content-type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({ intent: 'preview_rendered' }),
    });
  });

  it('records a fresh print audit before manual print actions', async () => {
    mockReportQueries();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            audited: true,
            report: {
              id: 'report_1',
              report_type: 'physician_report',
              content: physicianContent,
            },
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ReportPrintPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '手動印刷' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({ intent: 'print_requested' }),
    });
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it('blocks manual print when a fresh print audit cannot be recorded', async () => {
    mockReportQueries();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'PRINT_AUDIT_FAILED' }), { status: 500 }),
      );
    vi.stubGlobal('fetch', fetchMock);

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
});
