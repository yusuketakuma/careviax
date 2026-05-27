// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DrugMasterContent } from './drug-master-content';

setupDomTestEnv();

const { useOrgIdMock, pendingRequestsMock } = vi.hoisted(() => ({
  useOrgIdMock: vi.fn(),
  pendingRequestsMock: vi.fn(),
}));

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
      return {
        data: {
          data: [
            { id: 'site_1', name: '本店', address: '東京都' },
            { id: 'site_2', name: '支店', address: '東京都' },
          ],
        },
      };
    }
    if (key === 'pharmacy-drug-stocks') {
      return { data: { data: [] }, isLoading: false };
    }
    if (key === 'pharmacy-drug-stock-history') {
      return { data: { data: [] }, isLoading: false };
    }
    if (key === 'pharmacy-drug-stock-requests') {
      const requests = pendingRequestsMock();
      return {
        data: {
          data: requests,
          summary: {
            status: 'pending',
            total_count: requests.length,
            overdue_count: requests.length > 0 ? 1 : 0,
            overdue_days: 7,
            oldest_pending_created_at:
              requests.length > 0 ? '2026-05-20T00:00:00.000Z' : null,
            notification_level: requests.length > 0 ? 'overdue' : 'clear',
          },
        },
        isLoading: false,
      };
    }
    if (key === 'pharmacy-drug-stock-templates') {
      return {
        data: {
          data: [
            {
              id: 'template_1',
              name: '在宅内科 標準セット',
              description: null,
              source_site_id: 'site_1',
              item_count: 12,
              created_at: '2026-05-27T00:00:00.000Z',
            },
          ],
        },
        isLoading: false,
      };
    }
    if (key === 'pharmacy-drug-stock-usage-mismatch') {
      return {
        data: {
          period: {
            since: '2026-02-26T00:00:00.000Z',
            until: '2026-05-27T00:00:00.000Z',
          },
          thresholds: {
            days: 90,
            frequent_threshold: 2,
            draft_limit: 500,
            limit: 10,
          },
          totals: {
            scanned_draft_count: 2,
            used_drug_count: 2,
            medication_line_count: 3,
            matched_drug_count: 2,
            unmatched_drug_count: 0,
            stocked_count: 1,
            frequent_unstocked_count: 1,
            unused_stocked_count: 1,
            displayed_frequent_unstocked_count: 1,
            displayed_unused_stocked_count: 1,
          },
          frequent_unstocked: [
            {
              drug_code: '111111111111',
              drug_name: '頻出未採用薬',
              count: 2,
              last_seen_at: '2026-05-26T00:00:00.000Z',
              matched_drug: {
                id: 'drug_unstocked',
                yj_code: '111111111111',
                drug_name: '頻出未採用薬',
                generic_name: null,
                drug_price: 10,
                unit: '錠',
                is_generic: true,
              },
            },
          ],
          unused_stocked: [
            {
              id: 'stock_unused',
              drug_master_id: 'drug_unused',
              reorder_point: 10,
              updated_at: '2026-05-21T00:00:00.000Z',
              drug_master: {
                id: 'drug_unused',
                yj_code: '333333333333',
                drug_name: '未使用採用品',
                generic_name: null,
                drug_price: 20,
                unit: '錠',
                is_generic: false,
              },
            },
          ],
          unmatched_prescribed: [],
        },
        isLoading: false,
      };
    }
    if (key === 'pharmacy-drug-stocks-impact') {
      return {
        data: {
          recent_changes: [],
          totals: {
            stocked_count: 0,
            review_due_count: 0,
            missing_reorder_point_count: 0,
            safety_flagged_count: 0,
            high_risk_count: 2,
            lasa_risk_count: 1,
            controlled_count: 1,
            transitional_expiry_count: 0,
            transitional_expiry_within_30_count: 0,
            transitional_expiry_within_60_count: 0,
            transitional_expiry_within_90_count: 0,
            action_required_count: 0,
            recent_master_change_count: 0,
          },
          selected_queue: {
            key: 'action_required',
            rows: [],
            total_count: 0,
          },
          master_change_report: {
            cutoff: '2026-04-01T00:00:00.000Z',
            total_count: 0,
            sampled_count: 0,
            is_truncated: false,
            change_type_counts: [],
            rows: [],
            price_impact: {
              usage_window_days: 90,
              scanned_draft_count: 0,
              estimated_total_delta: 0,
              rows: [],
            },
          },
          follow_up_summary: {
            unresolved_count: 2,
            overdue_count: 1,
            missing_due_date_count: 1,
          },
          samples: {
            review_due: [],
            missing_reorder_point: [],
            safety_flagged: [],
            high_risk: [],
            lasa_risk: [],
            controlled: [],
            transitional_expiry: [],
            action_required: [],
            recently_changed: [],
          },
        },
        isLoading: false,
      };
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
              recent_runs_30d: {
                total: 3,
                failed: 0,
                failure_streak: 0,
                latest_status: 'completed',
                latest_imported_at: '2026-04-20T00:00:00.000Z',
              },
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
              recent_runs_30d: {
                total: 2,
                failed: 2,
                failure_streak: 2,
                latest_status: 'failed',
                latest_imported_at: '2026-04-21T00:00:00.000Z',
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
    pendingRequestsMock.mockReturnValue([]);
  });

  it('shows PMDA and other externally configured sources in master status', () => {
    render(<DrugMasterContent />);

    expect(screen.getByText('SSK基本マスター')).toBeTruthy();
    expect(screen.getByText('PMDA 添付文書')).toBeTruthy();
    expect(screen.getByText(/添付文書: 0件/)).toBeTruthy();
    expect(screen.getByText(/相互作用: 0件/)).toBeTruthy();
    expect(screen.getByText('外部設定')).toBeTruthy();
    expect(screen.getByText(/直近失敗: URL未設定/)).toBeTruthy();
    expect(screen.getByText('直近30日: 2回 / 失敗 2回')).toBeTruthy();
    expect(screen.getByText('連続失敗 2回')).toBeTruthy();
    expect(screen.getByRole('button', { name: '鮮度チェック' })).toBeTruthy();
    expect(screen.getByLabelText('取込履歴ソース')).toBeTruthy();
    expect(screen.getByLabelText('取込履歴状態')).toBeTruthy();
  });

  it('shows medication-safety filters for high-risk and LASA review', () => {
    render(<DrugMasterContent />);

    expect(screen.getByLabelText('ハイリスク薬のみ')).toBeTruthy();
    expect(screen.getByLabelText('LASA注意のみ')).toBeTruthy();
  });

  it('enables stocked-only filtering by default on the formulary view', () => {
    render(<DrugMasterContent variant="formulary" />);

    expect(screen.getByRole('checkbox', { name: '採用品のみ' })).toHaveProperty('checked', true);
  });

  it('shows bulk import and review controls on the formulary view', () => {
    render(<DrugMasterContent variant="formulary" />);

    expect(screen.getByText('採用薬リスト運用')).toBeTruthy();
    expect(screen.getByText('採用品変更申請')).toBeTruthy();
    expect(screen.getByText('処方・採用品不一致')).toBeTruthy();
    expect(screen.getByText('頻出未採用薬')).toBeTruthy();
    expect(screen.getByText('未使用採用品')).toBeTruthy();
    expect(screen.getByText('影響レビューキュー')).toBeTruthy();
    expect(screen.getByText('未解決フォローアップ')).toBeTruthy();
    expect(screen.getByText('期限超過')).toBeTruthy();
    expect(screen.getByText('ハイリスク採用品')).toBeTruthy();
    expect(screen.getByText('LASA注意採用品')).toBeTruthy();
    expect(screen.getByText('規制薬採用品')).toBeTruthy();
    expect(screen.getByRole('button', { name: '安全性フォローアップ作成' })).toBeTruthy();
    expect(screen.getByText('経過措置30日以内')).toBeTruthy();
    expect(screen.getAllByText('経過措置90日以内').length).toBeGreaterThan(0);
    expect(screen.getByText('薬価改定差分レポート')).toBeTruthy();
    expect(screen.getByText(/薬価影響額推計/)).toBeTruthy();
    expect(screen.getByText('拠点間コピー')).toBeTruthy();
    expect(screen.getByText('施設別採用品テンプレート')).toBeTruthy();
    expect(screen.getByLabelText('採用品テンプレート検索')).toBeTruthy();
    expect(screen.getByLabelText('採用品テンプレート名')).toBeTruthy();
    expect(screen.getByRole('button', { name: /適用差分確認/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /テンプレートを適用/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '採用品テンプレートを削除' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /コピー差分確認/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /採用品をコピー/ })).toBeTruthy();
    expect(screen.getByLabelText('CSV一括登録')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^差分確認$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /一括登録/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /CSVテンプレート/ })).toBeTruthy();
    expect(screen.getByLabelText('CSV出力用途')).toBeTruthy();
    expect(screen.getByRole('button', { name: /CSV出力/ })).toBeTruthy();
  });

  it('shows approve and reject actions for pending formulary requests', () => {
    pendingRequestsMock.mockReturnValue([
      {
        id: 'request_1',
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        status: 'pending',
        action_type: 'adopt',
        requested_payload: { is_stocked: true },
        reason: '新規採用候補',
        created_at: '2026-05-27T00:00:00.000Z',
      },
    ]);

    render(<DrugMasterContent variant="formulary" />);

    expect(screen.getByText('未承認 1件')).toBeTruthy();
    expect(screen.getByText('7日超過')).toBeTruthy();
    expect(screen.getByText('最古申請')).toBeTruthy();
    expect(screen.getByText('採用追加')).toBeTruthy();
    expect(screen.getByRole('button', { name: '承認' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '却下' })).toBeTruthy();
  });
});
