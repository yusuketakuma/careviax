// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { Row } from '@tanstack/react-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

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

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    data,
    renderExpandedRow,
  }: {
    data: Array<{ job_type: string }>;
    renderExpandedRow?: (row: Row<{ job_type: string }>) => React.ReactNode;
  }) => (
    <div data-testid="jobs-table">
      {data.map((entry) => (
        <section key={entry.job_type}>
          <p>{entry.job_type}</p>
          <div data-testid={`expanded-${entry.job_type}`}>
            {renderExpandedRow?.({ original: entry } as Row<{ job_type: string }>)}
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
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
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
    expect(screen.getByText('一部失敗')).toBeTruthy();
    expect(screen.getByText('対象 2件 / 成功 1件 / 失敗 1件')).toBeTruthy();
    expect(screen.getByText('詳細は監査ログと保管元ジョブを確認してください。')).toBeTruthy();
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
});
