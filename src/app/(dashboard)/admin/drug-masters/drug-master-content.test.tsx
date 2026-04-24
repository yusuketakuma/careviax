// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DrugMasterContent } from './drug-master-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: null,
  }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0];
    if (key === 'drug-masters') {
      return { data: { data: [], totalCount: 0, hasMore: false }, isLoading: false };
    }
    if (key === 'pharmacy-sites') {
      return { data: { data: [] } };
    }
    if (key === 'drug-master-status') {
      return {
        data: {
          sources: [
            {
              source: 'ssk',
              label: 'SSK基本マスター',
              is_free: true,
              threshold_days: 45,
              last_success: {
                imported_at: '2026-04-20T00:00:00.000Z',
                record_count: 100,
                days_ago: 2,
              },
              last_failure: null,
              freshness: 'fresh',
            },
            {
              source: 'pmda',
              label: 'PMDA 添付文書',
              is_free: false,
              threshold_days: 14,
              last_success: null,
              last_failure: {
                imported_at: '2026-04-21T00:00:00.000Z',
                error: 'URL未設定',
              },
              freshness: 'never',
            },
          ],
          totals: {
            drug_master_count: 0,
            hot_code_coverage: 0,
            package_insert_count: 0,
            interaction_count: 0,
            active_alert_rule_count: 0,
            generic_mapping_count: 0,
          },
          checked_at: '2026-04-22T00:00:00.000Z',
        },
      };
    }
    if (key === 'drug-master-import-logs') {
      return { data: { data: [] }, isLoading: false };
    }
    return { data: null, isLoading: false, isError: false };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: () => <div data-testid="drug-master-table" />,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('DrugMasterContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('shows PMDA and other externally configured sources in master status', () => {
    render(<DrugMasterContent />);

    expect(screen.getByText('SSK基本マスター')).toBeTruthy();
    expect(screen.getByText('PMDA 添付文書')).toBeTruthy();
    expect(screen.getByText(/添付文書: 0件/)).toBeTruthy();
    expect(screen.getByText(/相互作用: 0件/)).toBeTruthy();
    expect(screen.getByText('外部設定')).toBeTruthy();
    expect(screen.getByText(/直近失敗: URL未設定/)).toBeTruthy();
  });
});
