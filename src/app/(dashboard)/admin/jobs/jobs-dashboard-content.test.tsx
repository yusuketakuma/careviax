// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { Row } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const mutationMutateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
    errorMessage,
    onRetry,
    renderExpandedRow,
  }: {
    columns: Array<{
      id?: string;
      cell?: (args: { row: { original: Record<string, unknown> } }) => ReactNode;
    }>;
    data: Array<{ job_type: string } & Record<string, unknown>>;
    errorMessage?: string;
    onRetry?: () => void;
    renderExpandedRow?: (row: Row<{ job_type: string } & Record<string, unknown>>) => ReactNode;
  }) => (
    <div data-testid="jobs-table">
      {errorMessage ? (
        <div role="alert">
          <p>{errorMessage}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              再読み込み
            </button>
          ) : null}
        </div>
      ) : null}
      {data.map((entry) => (
        <section key={entry.job_type}>
          <p>{entry.job_type}</p>
          {columns.map((column, columnIndex) =>
            column.cell ? (
              <div key={`${entry.job_type}-${column.id ?? columnIndex}`}>
                {column.cell({ row: { original: entry } })}
              </div>
            ) : null,
          )}
          <div data-testid={`expanded-${entry.job_type}`}>
            {renderExpandedRow?.({ original: entry } as Row<
              { job_type: string } & Record<string, unknown>
            >)}
          </div>
        </section>
      ))}
    </div>
  ),
}));

import { JobsDashboardContent, getBulkExportRunSummary } from './jobs-dashboard-content';

setupDomTestEnv();

function buildBulkExportRun(
  output: unknown,
): NonNullable<Parameters<typeof getBulkExportRunSummary>[0]> {
  return {
    id: 'job_1',
    job_type: 'medication-history-bulk-export',
    status: 'completed',
    output,
    error_summary: null,
    retry_count: 0,
    max_retries: 3,
    started_at: null,
    completed_at: null,
    created_at: '2026-05-21T01:00:00.000Z',
  };
}

describe('JobsDashboardContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: mutationMutateMock, isPending: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces completed bulk export partial failures from job output', () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: {
        data: [
          {
            job_type: 'medication-history-bulk-export-drain',
            schedule_hint: '15分毎 + 要求時',
            endpoint: '/api/jobs/medication-history-bulk-export-drain',
            latest_run: {
              id: 'drain_1',
              job_type: 'medication-history-bulk-export-drain',
              status: 'completed',
              output: null,
              error_summary: null,
              retry_count: 0,
              max_retries: 3,
              started_at: '2026-05-21T00:59:00.000Z',
              completed_at: '2026-05-21T00:59:30.000Z',
              created_at: '2026-05-21T00:59:00.000Z',
            },
            latest_export_run: {
              id: 'job_1',
              job_type: 'medication-history-bulk-export',
              status: 'completed',
              output: {
                requestedCount: 2,
                patientCount: 1,
                failedCount: 1,
              },
              error_summary: null,
              retry_count: 0,
              max_retries: 3,
              started_at: '2026-05-21T01:00:00.000Z',
              completed_at: '2026-05-21T01:01:00.000Z',
              created_at: '2026-05-21T01:00:00.000Z',
            },
          },
        ],
      },
    });

    render(<JobsDashboardContent />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['integration-jobs', 'org_1'],
        refetchInterval: 60_000,
      }),
    );
    expect(screen.getByText('対応が必要なジョブ')).toBeTruthy();
    expect(screen.getAllByText('一部失敗').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('対象 2件 / 成功 1件 / 失敗 1件').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('詳細は監査ログと保管元ジョブを確認してください。')).toBeTruthy();

    const attentionHeading = screen.getByText('対応が必要なジョブ');
    const summaryHeading = screen.getByText('登録ジョブ数');
    expect(
      attentionHeading.compareDocumentPosition(summaryHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const rerunButtons = screen.getAllByRole('button', {
      name: 'medication-history-bulk-export-drain を再実行',
    });
    expect(rerunButtons[0]?.className).toContain('!min-h-[44px]');
  });

  it('fetches jobs through the static API path with org headers and unwraps the data envelope', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                job_type: 'daily',
                schedule_hint: '毎朝',
                endpoint: '/api/jobs/daily',
                latest_run: null,
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: { data: [] },
      refetch: vi.fn(),
    });

    render(<JobsDashboardContent />);

    const queryOptions = useQueryMock.mock.calls.at(-1)?.[0] as
      | { queryKey: unknown[]; queryFn: () => Promise<{ data: unknown[] }> }
      | undefined;
    expect(queryOptions?.queryKey).toEqual(['integration-jobs', 'org_1']);
    await expect(queryOptions?.queryFn()).resolves.toEqual({
      data: [
        {
          job_type: 'daily',
          schedule_hint: '毎朝',
          endpoint: '/api/jobs/daily',
          latest_run: null,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs', {
      headers: { 'x-org-id': 'org_1' },
    });
  });

  it('ignores malformed or successful bulk export output', () => {
    const run = buildBulkExportRun({
      requestedCount: 2,
      patientCount: 2,
      failedCount: 0,
    });

    expect(getBulkExportRunSummary(run)).toBeNull();
    expect(getBulkExportRunSummary(buildBulkExportRun('not-json-object'))).toBeNull();
  });

  it('handles malformed partial output without inventing counts or unsafe errors', () => {
    expect(
      getBulkExportRunSummary(
        buildBulkExportRun({
          requestedCount: '2',
          patientCount: Number.POSITIVE_INFINITY,
          failedCount: 2,
          errors: ['patient_2: PDF 生成に失敗しました', 123, null],
        }),
      ),
    ).toEqual({
      requestedCount: null,
      successfulCount: null,
      failedCount: 2,
    });

    expect(
      getBulkExportRunSummary(
        buildBulkExportRun({
          requestedCount: 2,
          patientCount: 1,
          failedCount: '1',
          errors: ['patient_2: PDF 生成に失敗しました'],
        }),
      ),
    ).toBeNull();
  });

  it('renders a structured error summary instead of raw error_log text and points to CloudWatch for details', () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: {
        data: [
          {
            job_type: 'daily-billing-evidence',
            schedule_hint: '毎朝',
            endpoint: '/api/jobs/daily-billing-evidence',
            latest_run: {
              id: 'run_failed',
              job_type: 'daily-billing-evidence',
              status: 'failed',
              output: null,
              // The API never sends raw error_log content; this fixture asserts
              // the UI renders only the structured, pre-redacted summary.
              error_summary: {
                error_name: 'リトライ上限到達',
                occurred_at: '2026-05-21T00:59:30.000Z',
                message: 'エラーが記録されています',
              },
              retry_count: 3,
              max_retries: 3,
              started_at: '2026-05-21T00:59:00.000Z',
              completed_at: '2026-05-21T00:59:30.000Z',
              created_at: '2026-05-21T00:59:00.000Z',
            },
          },
        ],
      },
    });

    render(<JobsDashboardContent />);

    expect(screen.getAllByText('リトライ上限到達').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('エラーが記録されています').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(
        '詳細な生ログが必要な場合は CloudWatch を参照してください（本画面には表示されません）。',
      ),
    ).toBeTruthy();

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toContain('password');
    expect(bodyText).not.toContain('token=');
  });

  it('names rerun actions by job type and sends the row endpoint', () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: {
        data: [
          {
            job_type: 'daily',
            schedule_hint: '毎朝',
            endpoint: '/api/jobs/daily',
            latest_run: null,
          },
          {
            job_type: 'monthly',
            schedule_hint: '毎月',
            endpoint: '/api/jobs/monthly',
            latest_run: null,
          },
        ],
      },
    });

    render(<JobsDashboardContent />);

    expect(screen.getByRole('button', { name: 'daily を再実行' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'monthly を再実行' }));

    expect(mutationMutateMock).toHaveBeenCalledWith({
      endpoint: '/api/jobs/monthly',
      jobType: 'monthly',
    });
  });

  it('reruns jobs through the row endpoint with org JSON headers and an empty body', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ jobType: 'monthly', processedCount: 2 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: { data: [] },
      refetch: vi.fn(),
    });

    render(<JobsDashboardContent />);

    const mutationOptions = useMutationMock.mock.calls.at(-1)?.[0] as
      | {
          mutationFn: (args: { endpoint: string; jobType: string }) => Promise<string>;
        }
      | undefined;

    await expect(
      mutationOptions?.mutationFn({
        endpoint: '/api/jobs/monthly',
        jobType: 'monthly',
      }),
    ).resolves.toBe('monthly');
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs/monthly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify({}),
    });
  });

  it('keeps server messages and fallback copy when rerunning jobs fails', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: { data: [] },
      refetch: vi.fn(),
    });

    render(<JobsDashboardContent />);

    const mutationOptions = useMutationMock.mock.calls.at(-1)?.[0] as
      | {
          mutationFn: (args: { endpoint: string; jobType: string }) => Promise<string>;
        }
      | undefined;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'ジョブ再実行の権限がありません' }), {
        status: 403,
      }),
    );
    await expect(
      mutationOptions?.mutationFn({
        endpoint: '/api/jobs/monthly',
        jobType: 'monthly',
      }),
    ).rejects.toThrow('ジョブ再実行の権限がありません');

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 500 }));
    await expect(
      mutationOptions?.mutationFn({
        endpoint: '/api/jobs/monthly',
        jobType: 'monthly',
      }),
    ).rejects.toThrow('ジョブ "monthly" の再実行に失敗しました');
  });

  it('passes job query failures to DataTable without showing false-zero counts', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch,
    });

    render(<JobsDashboardContent />);

    expect(screen.queryByText('ジョブ状態を読み込み中です。')).toBeNull();
    expect(
      screen.getByText('ジョブ状態を確認できませんでした。下の一覧で再読み込みしてください。'),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('ジョブ一覧を取得できませんでした');
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.getByText('—件')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    expect(refetch).toHaveBeenCalled();
  });

  it('uses a named skeleton for the attention panel while job counts are loading', () => {
    useQueryMock.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
    });

    render(<JobsDashboardContent />);

    expect(screen.getByRole('status', { name: '対応が必要なジョブを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('ジョブ状態を読み込み中です。')).toBeNull();
    expect(
      screen.queryByText('ジョブ状態を確認できませんでした。下の一覧で再読み込みしてください。'),
    ).toBeNull();
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.getByText('—件')).toBeTruthy();
  });
});
