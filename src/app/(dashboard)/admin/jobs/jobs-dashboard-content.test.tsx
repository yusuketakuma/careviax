// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { Row } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    error_log: null,
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
              error_log: null,
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
              error_log: null,
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

  it('passes job query failures to DataTable without showing false-zero counts', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch,
    });

    render(<JobsDashboardContent />);

    expect(screen.getByRole('alert').textContent).toContain('ジョブ一覧を取得できませんでした');
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.getByText('—件')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    expect(refetch).toHaveBeenCalled();
  });
});
