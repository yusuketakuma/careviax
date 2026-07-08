// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data }: { data: unknown[] }) => (
    <div data-testid="facility-standards-table" data-rows={data.length} />
  ),
}));

// criteria checklist は本テスト対象外。安全な空サマリーへスタブ化する。
vi.mock('./facility-criteria-checklist', () => ({
  buildFacilityCriteriaRows: () => [],
  summarizeFacilityCriteriaRows: () => ({
    statusTone: 'unknown',
    statusLabel: '判定待ち',
    missingCount: 0,
    checkingCount: 0,
    okCount: 0,
    totalCount: 0,
    missingLabels: [],
    nextAction: '届出を登録してください。',
  }),
  FacilityCriteriaChecklist: () => <div data-testid="facility-criteria-checklist" />,
}));

import { FacilityStandardsContent } from './facility-standards-content';

setupDomTestEnv();

const SUCCESS_DATA = {
  data: {
    data: [
      {
        id: 'standard_1',
        standard_type: '在宅患者訪問薬剤管理指導',
        filed_date: '2025-04-01T00:00:00.000Z',
        requirements_status: 'met',
        expiry_date: '2028-03-31T00:00:00.000Z',
        claim_status: 'claimable',
      },
    ],
    meta: {
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'facility_standards',
      filters_applied: {},
      limit: 100,
    },
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

describe('FacilityStandardsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue(SUCCESS_DATA);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the standards table when the query succeeds', () => {
    render(<FacilityStandardsContent />);

    const table = screen.getByTestId('facility-standards-table');
    expect(table).toBeTruthy();
    expect(table.getAttribute('data-rows')).toBe('1');
    expect(screen.getByText('登録1件')).toBeTruthy();
  });

  it('fetches facility standards through the static API path with org headers', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: SUCCESS_DATA.data.data,
            meta: {
              total_count: 1,
              visible_count: 1,
              hidden_count: 0,
              truncated: false,
              count_basis: 'facility_standards',
              filters_applied: {},
              limit: 100,
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<FacilityStandardsContent />);

    const queryOptions = useQueryMock.mock.calls.at(-1)?.[0] as
      | { queryKey: unknown[]; queryFn: () => Promise<unknown> }
      | undefined;
    expect(queryOptions?.queryKey).toEqual(['facility-standards', 'org_1']);
    await expect(queryOptions?.queryFn()).resolves.toMatchObject({
      data: SUCCESS_DATA.data.data,
      meta: {
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        truncated: false,
        count_basis: 'facility_standards',
      },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/facility-standards', {
      headers: { 'x-org-id': 'org_1' },
    });
  });

  it('shows hidden counts and avoids whole-list claim judgement when standards are truncated', () => {
    useQueryMock.mockReturnValue({
      ...SUCCESS_DATA,
      data: {
        ...SUCCESS_DATA.data,
        meta: {
          ...SUCCESS_DATA.data.meta,
          total_count: 3,
          visible_count: 1,
          hidden_count: 2,
          truncated: true,
        },
      },
    });

    render(<FacilityStandardsContent />);

    expect(screen.getByText('先頭1件を表示 / 他2件')).toBeTruthy();
    expect(screen.getByText('表示中のみ判定')).toBeTruthy();
    expect(
      screen.getByText('非表示の届出が2件あります。判定は表示中の届出に限定されています。'),
    ).toBeTruthy();
  });

  it('shows ErrorState (not a misleading judgement) with retry when the query fails', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<FacilityStandardsContent />);

    expect(screen.getByText('サーバーエラーが発生しました')).toBeTruthy();
    // 空データから誤判定/空テーブルを出していないこと。
    expect(screen.queryByTestId('facility-standards-table')).toBeNull();
    expect(screen.queryByText('今日の判定')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
