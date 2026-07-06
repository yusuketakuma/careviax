// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  buildDrugMasterApiPath,
  buildDrugMasterGenericRecommendationsApiPath,
  buildDrugMasterIngredientGroupApiPath,
} from '@/lib/drug-masters/api-paths';
import {
  buildPharmacyDrugStockRequestApiPath,
  buildPharmacyDrugStockTemplateApiPath,
  buildPharmacyDrugStockTemplateApplyApiPath,
} from '@/lib/pharmacy-drug-stocks/api-paths';
import { DrugMasterContent, parseReorderPointInput } from './drug-master-content';

setupDomTestEnv();

type MutationOptions = {
  mutationFn?: (...args: unknown[]) => unknown;
  onSuccess?: (...args: unknown[]) => unknown;
  onError?: (...args: unknown[]) => unknown;
};

const {
  useOrgIdMock,
  pendingRequestsMock,
  mutationMutateMock,
  lastMutationOptions,
  invalidateQueriesMock,
  capturedQueryKeys,
  capturedQueryOptions,
  detailDataMock,
  stockConfigDataMock,
  candidatesDataMock,
  genericRecommendationsDataMock,
  ingredientGroupDataMock,
  importLogsDataMock,
  queryErrorKeys,
  queryLoadingKeys,
  staleQueryDataByKey,
  refetchSpies,
  toastSuccessMock,
  toastErrorMock,
  drugMastersPagesMock,
  fetchNextDrugMastersMock,
  dataTablePropsMock,
} = vi.hoisted(() => ({
  useOrgIdMock: vi.fn(),
  pendingRequestsMock: vi.fn(),
  mutationMutateMock: vi.fn(),
  lastMutationOptions: { current: null as MutationOptions | null },
  // Controllable so a test can hold invalidation pending and assert previews are already cleared
  // synchronously (before the await resolves). Defaults to immediate resolve.
  invalidateQueriesMock: vi.fn((): Promise<void> => Promise.resolve()),
  // slice4b: every useQuery call records its FULL queryKey here so filter tests can assert the
  // key shape reacts to the migrated Select state (state+queryKey, not DOM-only).
  capturedQueryKeys: [] as ReadonlyArray<unknown>[],
  capturedQueryOptions: [] as Array<{
    queryKey: readonly unknown[];
    queryFn?: () => unknown;
  }>,
  // slice4c: controllable payloads for the drug-detail panel queries so a test can render the
  // 採用後発薬 (preferred generic) Select. Default null/empty preserves the prior behavior
  // (the fallback `{ data: null }` branch) so every existing test is unaffected.
  detailDataMock: { current: null as unknown },
  stockConfigDataMock: { current: null as unknown },
  candidatesDataMock: { current: [] as unknown[] },
  genericRecommendationsDataMock: { current: [] as unknown[] },
  ingredientGroupDataMock: { current: null as unknown },
  importLogsDataMock: { current: [] as unknown[] },
  // Tests can mark query keys as failed to exercise the fetch-error affordances
  // (import logs / master status / site picker) without affecting success-path tests.
  queryErrorKeys: new Set<string>(),
  queryLoadingKeys: new Set<string>(),
  staleQueryDataByKey: new Map<string, unknown>(),
  refetchSpies: new Map<string, ReturnType<typeof vi.fn>>(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  // W2-F2: drug-masters は useInfiniteQuery。各テストが cursor 累積ページを差し替えられるよう
  // ページ配列を controllable にする。既定は空 1 ページ（従来の空表示挙動を維持）。
  drugMastersPagesMock: {
    current: [
      { data: [] as unknown[], totalCount: 0, hasMore: false, nextCursor: undefined },
    ] as Array<{
      data: unknown[];
      totalCount: number;
      hasMore: boolean;
      nextCursor?: string;
    }>,
  },
  fetchNextDrugMastersMock: vi.fn(),
  // DataTable は下でモックするが、load-more の配線（data 累積 / hasMore / onLoadMore）を
  // 検証できるよう最新 props をここに捕捉する。
  dataTablePropsMock: { current: null as Record<string, unknown> | null },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

vi.mock('@/lib/drug-masters/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/drug-masters/api-paths')>();
  return {
    ...actual,
    buildDrugMasterApiPath: vi.fn(actual.buildDrugMasterApiPath),
    buildDrugMasterGenericRecommendationsApiPath: vi.fn(
      actual.buildDrugMasterGenericRecommendationsApiPath,
    ),
    buildDrugMasterIngredientGroupApiPath: vi.fn(actual.buildDrugMasterIngredientGroupApiPath),
  };
});

vi.mock('@/lib/pharmacy-drug-stocks/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/pharmacy-drug-stocks/api-paths')>();
  return {
    ...actual,
    buildPharmacyDrugStockRequestApiPath: vi.fn(actual.buildPharmacyDrugStockRequestApiPath),
    buildPharmacyDrugStockTemplateApiPath: vi.fn(actual.buildPharmacyDrugStockTemplateApiPath),
    buildPharmacyDrugStockTemplateApplyApiPath: vi.fn(
      actual.buildPharmacyDrugStockTemplateApplyApiPath,
    ),
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options?: MutationOptions) => ({
    mutate: (...args: unknown[]) => {
      lastMutationOptions.current = options ?? null;
      mutationMutateMock(...args);
    },
    isPending: false,
    variables: null,
  }),
  useQuery: (options: { queryKey: readonly unknown[]; queryFn?: () => unknown }) => {
    const { queryKey } = options;
    capturedQueryKeys.push(queryKey as ReadonlyArray<unknown>);
    capturedQueryOptions.push(options);
    const key = queryKey[0];
    const shortKey = String(key);
    const fullKey = queryKey.map((part) => String(part ?? '')).join('|');
    const failedKey = queryErrorKeys.has(fullKey)
      ? fullKey
      : queryErrorKeys.has(shortKey)
        ? shortKey
        : null;
    const loadingKey = queryLoadingKeys.has(fullKey)
      ? fullKey
      : queryLoadingKeys.has(shortKey)
        ? shortKey
        : null;
    if (failedKey) {
      let refetch = refetchSpies.get(failedKey);
      if (!refetch) {
        refetch = vi.fn();
        refetchSpies.set(failedKey, refetch);
      }
      return {
        data: staleQueryDataByKey.get(failedKey),
        isLoading: false,
        isError: true,
        error: new Error(
          `GET /api/${failedKey}?patient=田中一郎&storage_key=s3://phi-bucket/raw&token=secret&provider_error=stack`,
        ),
        refetch,
      };
    }
    if (loadingKey) {
      return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    }
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
            oldest_pending_created_at: requests.length > 0 ? '2026-05-20T00:00:00.000Z' : null,
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
                source_file_hash:
                  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
                source_published_at: '2026-04-19T00:00:00.000Z',
                import_mode: 'full',
                change_summary: {
                  mode: 'full',
                  parsed_records: 100,
                  imported_records: 100,
                },
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
            drug_package_count: 42,
            drug_package_coverage: 7,
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
      return { data: { data: importLogsDataMock.current }, isLoading: false };
    }
    // slice4c: drug-detail panel queries that back the 採用後発薬 (preferred generic) Select.
    // Controllable via the hoisted refs; default values keep the prior null/empty behavior.
    if (key === 'drug-master-detail') {
      return { data: detailDataMock.current, isLoading: false, isError: false };
    }
    if (key === 'pharmacy-drug-stock') {
      return { data: { data: stockConfigDataMock.current }, isLoading: false };
    }
    if (key === 'preferred-generic-candidates') {
      return { data: { data: candidatesDataMock.current }, isLoading: false };
    }
    if (key === 'generic-recommendations') {
      return {
        data: { recommendations: genericRecommendationsDataMock.current },
        isLoading: false,
        isError: false,
      };
    }
    if (key === 'ingredient-group') {
      return { data: ingredientGroupDataMock.current, isLoading: false, isError: false };
    }
    return { data: null, isLoading: false, isError: false };
  },
  useInfiniteQuery: (options: { queryKey: readonly unknown[]; queryFn?: () => unknown }) => {
    const { queryKey } = options;
    capturedQueryKeys.push(queryKey as ReadonlyArray<unknown>);
    capturedQueryOptions.push(options);
    const key = queryKey[0];
    const shortKey = String(key);
    const fullKey = queryKey.map((part) => String(part ?? '')).join('|');
    const failedKey = queryErrorKeys.has(fullKey)
      ? fullKey
      : queryErrorKeys.has(shortKey)
        ? shortKey
        : null;
    if (failedKey) {
      let refetch = refetchSpies.get(failedKey);
      if (!refetch) {
        refetch = vi.fn();
        refetchSpies.set(failedKey, refetch);
      }
      return {
        data: staleQueryDataByKey.get(failedKey),
        isLoading: false,
        isError: true,
        error: new Error('医薬品マスターの取得に失敗しました'),
        refetch,
        fetchNextPage: fetchNextDrugMastersMock,
        hasNextPage: false,
        isFetchingNextPage: false,
      };
    }
    if (key === 'drug-masters') {
      const pages = drugMastersPagesMock.current;
      return {
        data: { pages, pageParams: [] },
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        fetchNextPage: fetchNextDrugMastersMock,
        hasNextPage: pages[pages.length - 1]?.hasMore ?? false,
        isFetchingNextPage: false,
      };
    }
    return {
      data: { pages: [], pageParams: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    };
  },
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: (props: Record<string, unknown>) => {
    // load-more 配線の検証用に最新 props を捕捉する（data 累積 / hasMore / onLoadMore）。
    dataTablePropsMock.current = props;
    return <div data-testid="drug-master-table" />;
  },
}));

// Records the original className of every SelectItem so the >=44px touch-target contract
// can be asserted on the SOURCE className (the mock must not inject min-h itself). selectKey is the
// owning Select's trigger id || aria-label || aria-labelledby, so items from different Selects
// (e.g. target-site site_2 vs copy-source site_2) are captured + deduped INDEPENDENTLY.
const capturedSelectItems: Array<{
  selectKey: string;
  value: unknown;
  children: ReactNode;
  className?: string;
}> = [];

// R1 teeth: a one-shot synchronous hook the MockSelect runs INSIDE the native <select> onChange,
// immediately AFTER the component's onValueChange (which runs applySelectedTemplateId etc.
// synchronously) but BEFORE control returns to RTL's act wrapper / passive-effect flush. Tests use
// it to invoke a stale onSuccess in the SAME turn, so a regression that drops the synchronous ref
// write (leaving only the passive useEffect backstop) is NOT masked by an effect flush.
const afterSelectChangeHook: { current: (() => void) | null } = { current: null };

// SelectItem children may be a node array (e.g. `name（count件）`); flatten to a plain string for
// label assertions without depending on React.Children inside the test body.
function flattenLabel(node: ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenLabel).join('');
  const element = node as { props?: { children?: ReactNode } };
  if (element.props && 'children' in element.props) return flattenLabel(element.props.children);
  return '';
}

// Base UI Select renders a portaled listbox jsdom can't drive; mock it to a native <select>
// that forwards the trigger's id/className/aria-* so getByRole('combobox', { name }) resolves,
// and that keeps clear/sentinel items so clear-back-to-'' flows stay testable.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  type ItemProps = { value?: unknown; children?: ReactNode; className?: string };
  type TriggerProps = {
    id?: string;
    className?: string;
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    children?: ReactNode;
  };

  // Marker components so the JSX tree (which is traversed BEFORE any of these render) can be
  // matched by component identity rather than by props injected at render time.
  const SelectContent = ({ children }: { children: ReactNode }) => <>{children}</>;
  const SelectItem = ({ children }: ItemProps) => <>{children}</>;
  const SelectTrigger = ({ children }: TriggerProps) => <>{children}</>;
  const SelectValue = ({
    placeholder,
    children,
  }: {
    placeholder?: string;
    children?: ReactNode;
  }) => <>{children ?? placeholder ?? null}</>;

  function collectItems(children: ReactNode, selectKey: string): ItemProps[] {
    const items: ItemProps[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as ItemProps;
      if (child.type === SelectItem) {
        const item = {
          value: props.value,
          children: props.children,
          className: props.className,
        };
        items.push(item);
        // Capture the ORIGINAL SelectItem className (the mock never injects min-h itself)
        // so the >=44px touch-target contract can be asserted on the source value.
        // Dedup by selectKey+value+label so StrictMode/rerenders don't inflate the module array
        // (N1) while keeping per-Select items distinct (R3): one Select's item can never satisfy
        // another Select's assertion.
        const key = `${selectKey}::${String(item.value)}::${flattenLabel(item.children)}`;
        if (
          !capturedSelectItems.some(
            (c) => `${c.selectKey}::${String(c.value)}::${flattenLabel(c.children)}` === key,
          )
        ) {
          capturedSelectItems.push({ selectKey, ...item });
        }
      }
      items.push(...collectItems(props.children, selectKey));
    });
    return items;
  }

  function findTriggerProps(children: ReactNode): TriggerProps | undefined {
    let triggerProps: TriggerProps | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as TriggerProps;
      if (child.type === SelectTrigger) triggerProps = props;
      if (!triggerProps) triggerProps = findTriggerProps(props.children);
    });
    return triggerProps;
  }

  function findPlaceholder(children: ReactNode): string | undefined {
    let placeholder: string | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { placeholder?: string; children?: ReactNode };
      if (child.type === SelectValue && props.placeholder) placeholder = props.placeholder;
      if (placeholder === undefined) placeholder = findPlaceholder(props.children);
    });
    return placeholder;
  }

  // Mirror findPlaceholder, but return the SelectValue element's own props so we can faithfully
  // model Base UI's closed-trigger label contract: children (the production label) win over
  // placeholder, and a BARE SelectValue (neither) must fall back to the raw value — the
  // regression a bare `<SelectValue />` would ship.
  function findSelectValue(
    children: ReactNode,
  ): { children?: ReactNode; placeholder?: string } | undefined {
    let found: { children?: ReactNode; placeholder?: string } | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { placeholder?: string; children?: ReactNode };
      if (child.type === SelectValue && found === undefined) {
        found = { children: props.children, placeholder: props.placeholder };
      }
      if (found === undefined) found = findSelectValue(props.children);
    });
    return found;
  }

  function MockSelect({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) {
    const triggerProps = findTriggerProps(children);
    const placeholder = findPlaceholder(children);
    const selectValueProps = findSelectValue(children);
    // Per-Select identity for capture/dedupe: prefer the trigger id, then aria-label, then
    // aria-labelledby (all already forwarded by the mock). These are unique per migrated Select.
    const selectKey =
      triggerProps?.id ??
      triggerProps?.['aria-label'] ??
      triggerProps?.['aria-labelledby'] ??
      'unknown-select';
    // Reproduce Base UI's CLOSED-trigger label contract on SelectPrimitive.Value:
    //   children (production-supplied label) > placeholder > bare fallback.
    // The bare fallback is the regression: a non-empty value renders raw (e.g. "operations"),
    // an empty-string value renders blank — which is exactly what these assertions must catch.
    const selectValueChildrenText = flattenLabel(selectValueProps?.children);
    const displayLabel =
      selectValueChildrenText !== ''
        ? selectValueChildrenText
        : (selectValueProps?.placeholder ?? (value === '' ? '' : String(value ?? '')));
    const items = collectItems(children, selectKey);
    return (
      <>
        <span data-testid={`${selectKey}-display`}>{displayLabel}</span>
        <select
          id={triggerProps?.id}
          className={triggerProps?.className}
          aria-label={triggerProps?.['aria-label']}
          aria-labelledby={triggerProps?.['aria-labelledby']}
          aria-describedby={triggerProps?.['aria-describedby']}
          aria-invalid={triggerProps?.['aria-invalid']}
          value={value}
          onChange={(event) => {
            onValueChange?.(event.target.value);
            // R1 teeth: run the one-shot stale-onSuccess hook in the SAME synchronous turn, before
            // RTL flushes passive effects, so the synchronous ref write is what must reject it.
            const hook = afterSelectChangeHook.current;
            if (hook) {
              afterSelectChangeHook.current = null;
              hook();
            }
          }}
        >
          <option value="">{placeholder ?? ''}</option>
          {items.map((item) => (
            <option key={String(item.value)} value={String(item.value)}>
              {React.Children.toArray(item.children).join('')}
            </option>
          ))}
        </select>
      </>
    );
  }

  return {
    Select: MockSelect,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  };
});

// slice4c: the drug-detail panel (which hosts the 採用後発薬 Select) lives inside a Base UI Dialog
// (Sheet) that portals + gates on `open` — the same class of primitive jsdom can't drive that we
// already mock for Select/DataTable. Mock it to render children inline so the panel is testable;
// the panel's own `detailQuery.data` guard (controlled via detailDataMock) decides what shows.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetClose: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

function confirmMasterImportAction(label = 'SSK全件取込') {
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getByRole('heading', { name: `${label}を実行しますか` })).toBeTruthy();
  expect(mutationMutateMock).not.toHaveBeenCalledWith('ssk');
  fireEvent.change(screen.getByPlaceholderText('取込実行'), {
    target: { value: '取込実行' },
  });
  fireEvent.click(screen.getByRole('button', { name: '取込実行' }));
}

function confirmAutoRefreshAction() {
  fireEvent.click(screen.getByRole('button', { name: /フリーマスター一括更新/ }));
  expect(
    screen.getByRole('heading', { name: 'フリーマスター一括更新を実行しますか' }),
  ).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText('一括更新'), {
    target: { value: '一括更新' },
  });
  fireEvent.click(screen.getByRole('button', { name: '一括更新' }));
}

async function runCurrentMutation(...args: unknown[]) {
  const options = lastMutationOptions.current;
  expect(options?.mutationFn).toBeTruthy();
  return options!.mutationFn!(...args);
}

describe('DrugMasterContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    pendingRequestsMock.mockReturnValue([]);
    mutationMutateMock.mockClear();
    lastMutationOptions.current = null;
    capturedQueryOptions.length = 0;
    capturedSelectItems.length = 0;
    detailDataMock.current = null;
    stockConfigDataMock.current = null;
    candidatesDataMock.current = [];
    genericRecommendationsDataMock.current = [];
    ingredientGroupDataMock.current = null;
    importLogsDataMock.current = [];
    drugMastersPagesMock.current = [
      { data: [], totalCount: 0, hasMore: false, nextCursor: undefined },
    ];
    dataTablePropsMock.current = null;
  });

  it('shows PMDA and other externally configured sources in master status', () => {
    render(<DrugMasterContent />);

    expect(screen.getByText('SSK基本マスター')).toBeTruthy();
    expect(screen.getByText('PMDA 添付文書')).toBeTruthy();
    expect(screen.getByText(/包装GTIN: 42件 \/ 7%/)).toBeTruthy();
    expect(screen.getByText(/添付文書: 0件/)).toBeTruthy();
    expect(screen.getByText(/相互作用: 0件/)).toBeTruthy();
    expect(screen.getByText('外部設定')).toBeTruthy();
    expect(screen.getByText(/直近失敗: URL未設定/)).toBeTruthy();
    expect(screen.getByText('sha256: abcdef012345')).toBeTruthy();
    expect(screen.getByText('published: 2026/4/19')).toBeTruthy();
    expect(screen.getByText('mode: 全件')).toBeTruthy();
    expect(screen.getByText('summary: 解析 100件 / 反映 100件')).toBeTruthy();
    expect(screen.getByText('直近30日: 2回 / 失敗 2回')).toBeTruthy();
    expect(screen.getByText('連続失敗 2回')).toBeTruthy();
    expect(screen.getByRole('button', { name: '鮮度チェック' })).toBeTruthy();
    expect(screen.getByLabelText('取込履歴ソース')).toBeTruthy();
    expect(screen.getByLabelText('取込履歴状態')).toBeTruthy();
  });

  it('requires typed confirmation before running an official master import', () => {
    render(<DrugMasterContent />);

    fireEvent.click(screen.getByRole('button', { name: 'SSK全件取込' }));

    expect(screen.getByRole('heading', { name: 'SSK全件取込を実行しますか' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取込実行' })).toHaveProperty('disabled', true);
    expect(mutationMutateMock).not.toHaveBeenCalledWith('ssk');

    fireEvent.change(screen.getByPlaceholderText('取込実行'), {
      target: { value: '取込実行' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取込実行' }));

    expect(mutationMutateMock).toHaveBeenCalledWith('ssk');
  });

  it('previews an official master import in the confirmation dialog before execution', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse(
        {
          data: {
            dryRun: true,
            mode: 'all',
            flags: {
              dryRun: true,
              operation: 'generic_flags',
              sourceFileHash: 'mhlw_flags_source_hash',
              preview: {
                summary: {
                  parsed_records: 10,
                  drug_master_upsert_count: 10,
                  changed_flag_count: 2,
                  skipped_invalid_yj: 1,
                  sampled_rows: 1,
                },
                rows: [
                  {
                    yj_code: '1124001F1030',
                    drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
                    action: 'upsert_generic_flag',
                  },
                ],
              },
            },
            mappings: {
              dryRun: true,
              operation: 'generic_mapping',
              preview: {
                summary: {
                  parsed_records: 4,
                  generic_mapping_replace_count: 3,
                  brand_candidate_count: 8,
                  skipped_invalid_yj: 2,
                  sampled_rows: 1,
                },
                rows: [
                  {
                    generic_name: 'エスタゾラム',
                    standard_name: '【般】エスタゾラム錠１ｍｇ',
                    action: 'replace_mapping',
                    brand_candidate_count: 8,
                  },
                ],
              },
            },
          },
        },
        200,
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    try {
      render(<DrugMasterContent />);

      fireEvent.click(screen.getByRole('button', { name: '一般名/後発更新' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '差分確認' }));
      });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/drug-master-imports/mhlw-generic',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      const requestBody = JSON.parse(
        String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
      );
      expect(requestBody).toEqual({
        mode: 'all',
        dryRun: true,
        previewLimit: 5,
      });
      expect(buildOrgJsonHeaders).toHaveBeenCalledWith('org_1');
      expect(screen.getByTestId('official-import-preview')).toBeTruthy();
      expect(screen.getByText('後発フラグ')).toBeTruthy();
      expect(screen.getByText(/DrugMaster 10件/)).toBeTruthy();
      expect(screen.getByText(/フラグ変更 2件/)).toBeTruthy();
      expect(screen.getByText(/YJ 1124001F1030/)).toBeTruthy();
      expect(screen.getByText(/薬品 エスタゾラム錠１ｍｇ「アメル」/)).toBeTruthy();
      expect(screen.getByText('一般名mapping')).toBeTruthy();
      expect(screen.getByText(/mapping 3件/)).toBeTruthy();
      expect(screen.getByText(/invalid YJ 2件/)).toBeTruthy();
      expect(screen.getByText(/標準名 【般】エスタゾラム錠１ｍｇ/)).toBeTruthy();
      expect(mutationMutateMock).not.toHaveBeenCalledWith('mhlw-generic');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to the import preview label when the preview failure has no message', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    try {
      render(<DrugMasterContent />);

      fireEvent.click(screen.getByRole('button', { name: '一般名/後発更新' }));
      fireEvent.click(screen.getByRole('button', { name: '差分確認' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('一般名/後発更新の差分確認に失敗しました');
      expect(toastErrorMock).toHaveBeenCalledWith('一般名/後発更新の差分確認に失敗しました');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/drug-master-imports/mhlw-generic',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('surfaces official import preview API error payloads', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'source URL未設定' }, 500));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    try {
      render(<DrugMasterContent />);

      fireEvent.click(screen.getByRole('button', { name: '一般名/後発更新' }));
      fireEvent.click(screen.getByRole('button', { name: '差分確認' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('source URL未設定');
      expect(toastErrorMock).toHaveBeenCalledWith('source URL未設定');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves official import and job mutation API messages', async () => {
    render(<DrugMasterContent />);

    confirmMasterImportAction();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ message: '医薬品マスター取込は管理者のみ実行できます' }, 403),
      ),
    );
    try {
      await expect(runCurrentMutation('ssk')).rejects.toThrow(
        '医薬品マスター取込は管理者のみ実行できます',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads auto-refresh processedCount from the top-level job response', async () => {
    render(<DrugMasterContent />);

    confirmAutoRefreshAction();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ jobType: 'drug-master-auto-refresh', processedCount: 7 }, 200),
      ),
    );
    try {
      const result = await runCurrentMutation();
      await act(async () => {
        await lastMutationOptions.current?.onSuccess?.(result);
      });

      expect(toastSuccessMock).toHaveBeenCalledWith('フリーマスター一括更新が完了しました（7件）');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back when job mutation errors are non-JSON', async () => {
    render(<DrugMasterContent />);

    confirmAutoRefreshAction();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 500 })),
    );
    try {
      await expect(runCurrentMutation()).rejects.toThrow('一括更新の実行に失敗しました');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('requires typed confirmation before running free master auto-refresh', () => {
    render(<DrugMasterContent />);

    fireEvent.click(screen.getByRole('button', { name: /フリーマスター一括更新/ }));

    expect(
      screen.getByRole('heading', { name: 'フリーマスター一括更新を実行しますか' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '一括更新' })).toHaveProperty('disabled', true);
    expect(mutationMutateMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('一括更新'), {
      target: { value: '一括更新' },
    });
    fireEvent.click(screen.getByRole('button', { name: '一括更新' }));

    expect(mutationMutateMock).toHaveBeenCalledWith();
  });

  it('shows official source fingerprints in the import history', () => {
    importLogsDataMock.current = [
      {
        id: 'log_1',
        source: 'ssk',
        imported_at: '2026-06-30T03:00:00.000Z',
        record_count: 125000,
        status: 'completed',
        error_log: null,
        source_url:
          'https://www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.files/y_ALL20260611.zip',
        source_file_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        source_published_at: '2026-06-11T00:00:00.000Z',
        import_mode: 'full',
        change_summary: {
          mode: 'full',
          parsed_records: 125000,
          imported_records: 125000,
        },
      },
    ];

    render(<DrugMasterContent />);

    expect(
      screen.getByText(
        'source: www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.files/y_ALL20260611.zip',
      ),
    ).toBeTruthy();
    expect(screen.getByText('sha256: 0123456789ab')).toBeTruthy();
    expect(screen.getByText('published: 2026/6/11')).toBeTruthy();
    expect(screen.getAllByText('mode: 全件').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('summary: 解析 125,000件 / 反映 125,000件')).toBeTruthy();
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
    expect(screen.getByRole('button', { name: /対象拠点全件CSV出力/ })).toBeTruthy();
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

  it('requires confirmation before deleting a formulary template', () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByLabelText('適用する採用品テンプレート'), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '在宅内科 標準セット（12件） を削除' }));

    expect(mutationMutateMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole('alertdialog', { name: '採用品テンプレートを削除しますか' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '在宅内科 標準セット（12件） を削除します。この操作は取り消せません。拠点への適用やコピー前にテンプレート内容を確認してください。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    expect(mutationMutateMock.mock.calls).toEqual([[]]);
  });

  it('requires confirmation before deciding pending formulary requests', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '承認' }));

    expect(mutationMutateMock).not.toHaveBeenCalled();
    expect(screen.getByText('採用品変更申請を承認します')).toBeTruthy();
    expect(screen.getByText(/薬剤ID: drug_1/)).toBeTruthy();
    expect(screen.getByText(/拠点ID: site_1/)).toBeTruthy();
    expect(screen.getByText(/申請内容:/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '承認' }));

    expect(mutationMutateMock).toHaveBeenCalledWith({
      request_id: 'request_1',
      decision: 'approve',
      decision_note: null,
    });
  });

  it('requires explicit reject text before rejecting a pending formulary request', () => {
    pendingRequestsMock.mockReturnValue([
      {
        id: 'request_1',
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        status: 'pending',
        action_type: 'deactivate',
        requested_payload: { is_stocked: false },
        reason: '採用解除候補',
        created_at: '2026-05-27T00:00:00.000Z',
      },
    ]);

    render(<DrugMasterContent variant="formulary" />);

    fireEvent.click(screen.getByRole('button', { name: '却下' }));

    expect(screen.getByText('採用品変更申請を却下します')).toBeTruthy();
    expect(screen.getByPlaceholderText('却下')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '却下' }).at(-1)).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByPlaceholderText('却下'), { target: { value: '却下' } });
    fireEvent.click(screen.getAllByRole('button', { name: '却下' }).at(-1)!);

    expect(mutationMutateMock).toHaveBeenCalledWith({
      request_id: 'request_1',
      decision: 'reject',
      decision_note: '申請内容を確認して却下',
    });
  });

  it('delegates dynamic drug-detail API paths and org headers to shared helpers', async () => {
    const drugMasterId = 'drug/a b?x=y#z';
    pendingRequestsMock.mockReturnValue([
      {
        id: 'request_1',
        site_id: 'site_1',
        drug_master_id: drugMasterId,
        status: 'pending',
        action_type: 'adopt',
        requested_payload: { is_stocked: true },
        reason: '新規採用候補',
        created_at: '2026-05-27T00:00:00.000Z',
      },
    ]);
    detailDataMock.current = {
      id: drugMasterId,
      yj_code: '9999999999',
      receipt_code: null,
      jan_code: null,
      drug_name: '先発薬A',
      drug_name_kana: null,
      generic_name: 'イブプロフェン',
      drug_price: 50,
      unit: '錠',
      dosage_form: null,
      therapeutic_category: null,
      manufacturer: null,
      is_generic: false,
      is_narcotic: false,
      is_psychotropic: false,
      is_high_risk: false,
      outpatient_injection_eligible: false,
      outpatient_injection_note: null,
      is_lasa_risk: false,
      tall_man_name: null,
      lasa_group_key: null,
      max_administration_days: null,
      stock_config: null,
      hot_code: null,
      transitional_expiry_date: null,
      package_inserts: [],
      interactions_as_a: [],
      interactions_as_b: [],
    };
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi.fn(async () => jsonResponse({ data: [], recommendations: [] }, 200));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    try {
      render(<DrugMasterContent variant="formulary" />);
      fireEvent.click(screen.getByText('採用追加'));

      const latestQueryFn = (queryName: string, idIndex: number) => {
        const option = capturedQueryOptions
          .filter((candidate) => candidate.queryKey[0] === queryName)
          .filter((candidate) => candidate.queryKey[idIndex] === drugMasterId)
          .at(-1);
        expect(option?.queryFn).toBeTruthy();
        return option!.queryFn!;
      };

      vi.mocked(buildDrugMasterApiPath).mockReturnValueOnce('/api/drug-masters/__helper_detail__');
      await latestQueryFn('drug-master-detail', 2)();
      expect(buildDrugMasterApiPath).toHaveBeenCalledWith(drugMasterId);
      expect(fetchMock).toHaveBeenLastCalledWith('/api/drug-masters/__helper_detail__', {
        headers: sentinelHeaders,
      });

      vi.mocked(buildDrugMasterGenericRecommendationsApiPath).mockReturnValueOnce(
        '/api/drug-masters/__helper_generic__',
      );
      await latestQueryFn('generic-recommendations', 3)();
      expect(buildDrugMasterGenericRecommendationsApiPath).toHaveBeenCalledWith(
        drugMasterId,
        expect.any(URLSearchParams),
      );
      expect(fetchMock).toHaveBeenLastCalledWith('/api/drug-masters/__helper_generic__', {
        headers: sentinelHeaders,
      });

      vi.mocked(buildDrugMasterIngredientGroupApiPath).mockReturnValueOnce(
        '/api/drug-masters/__helper_ingredient__',
      );
      await latestQueryFn('ingredient-group', 3)();
      expect(buildDrugMasterIngredientGroupApiPath).toHaveBeenCalledWith(
        drugMasterId,
        expect.any(URLSearchParams),
      );
      expect(fetchMock).toHaveBeenLastCalledWith('/api/drug-masters/__helper_ingredient__', {
        headers: sentinelHeaders,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('delegates formulary decision and template mutations to shared path/header helpers', async () => {
    const requestId = 'request/a b?x=y#z';
    pendingRequestsMock.mockReturnValue([
      {
        id: requestId,
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        status: 'pending',
        action_type: 'adopt',
        requested_payload: { is_stocked: true },
        reason: '新規採用候補',
        created_at: '2026-05-27T00:00:00.000Z',
      },
    ]);
    const jsonHeaders = {
      'Content-Type': 'application/json',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    const orgHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(jsonHeaders);
    vi.mocked(buildOrgHeaders).mockReturnValue(orgHeaders);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ request: { status: 'approved' }, data: {}, deleted: true }, 200),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    try {
      render(<DrugMasterContent variant="formulary" />);

      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      fireEvent.click(screen.getByRole('button', { name: '承認' }));
      const [decisionPayload] = mutationMutateMock.mock.calls.at(-1)!;
      vi.mocked(buildPharmacyDrugStockRequestApiPath).mockReturnValueOnce(
        '/api/pharmacy-drug-stock-requests/__helper_request__',
      );
      await lastMutationOptions.current!.mutationFn!(decisionPayload);
      expect(buildPharmacyDrugStockRequestApiPath).toHaveBeenCalledWith(requestId);
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/pharmacy-drug-stock-requests/__helper_request__',
        expect.objectContaining({ method: 'PATCH', headers: jsonHeaders }),
      );

      fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
        target: { value: 'template_1' },
      });
      fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));
      vi.mocked(buildPharmacyDrugStockTemplateApplyApiPath).mockReturnValueOnce(
        '/api/pharmacy-drug-stock-templates/__helper_template__/apply',
      );
      await lastMutationOptions.current!.mutationFn!({ dryRun: true });
      expect(buildPharmacyDrugStockTemplateApplyApiPath).toHaveBeenCalledWith('template_1');
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/pharmacy-drug-stock-templates/__helper_template__/apply',
        expect.objectContaining({ method: 'POST', headers: jsonHeaders }),
      );

      fireEvent.click(screen.getByRole('button', { name: '在宅内科 標準セット（12件） を削除' }));
      fireEvent.click(screen.getByRole('button', { name: '削除する' }));
      vi.mocked(buildPharmacyDrugStockTemplateApiPath).mockReturnValueOnce(
        '/api/pharmacy-drug-stock-templates/__helper_template__',
      );
      await lastMutationOptions.current!.mutationFn!();
      expect(buildPharmacyDrugStockTemplateApiPath).toHaveBeenCalledWith('template_1');
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/pharmacy-drug-stock-templates/__helper_template__',
        expect.objectContaining({ method: 'DELETE', headers: orgHeaders }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves server and fallback messages for formulary mutation groups', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByLabelText('CSV一括登録'), {
      target: { value: '222222222200,CSV薬1,1,,,' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'YJコードを指定してください' }, 422)),
    );
    try {
      await expect(runCurrentMutation()).rejects.toThrow('YJコードを指定してください');
    } finally {
      vi.unstubAllGlobals();
    }

    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: 'site_2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /コピー差分確認/ }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'コピー元拠点が見つかりません' }, 404)),
    );
    try {
      await expect(runCurrentMutation({ dryRun: true })).rejects.toThrow(
        'コピー元拠点が見つかりません',
      );
    } finally {
      vi.unstubAllGlobals();
    }

    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 500 })),
    );
    try {
      await expect(runCurrentMutation({ dryRun: true })).rejects.toThrow(
        '採用品テンプレートの適用に失敗しました',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('DrugMasterContent formulary select migration (slice4a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    pendingRequestsMock.mockReturnValue([]);
    mutationMutateMock.mockClear();
    lastMutationOptions.current = null;
    capturedQueryOptions.length = 0;
    capturedSelectItems.length = 0;
    afterSelectChangeHook.current = null;
    invalidateQueriesMock.mockReset();
    invalidateQueriesMock.mockImplementation(async () => undefined);
    detailDataMock.current = null;
    stockConfigDataMock.current = null;
    candidatesDataMock.current = [];
    genericRecommendationsDataMock.current = [];
    ingredientGroupDataMock.current = null;
    importLogsDataMock.current = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  // These builders produce the RAW server JSON for a dry-run (no request-context fields). The
  // request-context (`requestTargetSiteId`/`requestSourceSiteId`/`requestTemplateId`/`requestCsv`/
  // `requestOverwrite`) is stamped by the PRODUCTION mutationFn, so tests run the real captured
  // mutationFn (R3) instead of hand-injecting those fields.
  const makeTemplateServerResponse = () => ({
    itemCount: 12,
    appliedCount: 0,
    skippedCount: 0,
    overwrite: false,
    dryRun: true,
    preview: {
      summary: {
        item_count: 12,
        create_count: 3,
        update_count: 1,
        skip_existing_count: 0,
        apply_count: 4,
      },
      rows: [
        {
          action: 'create' as const,
          drug_master_id: 'drug_1',
          reorder_point: null,
          preferred_generic_id: null,
          drug_master: { id: 'drug_1', yj_code: '111111111111', drug_name: 'テンプレ薬' },
        },
      ],
    },
  });

  const makeCopyServerResponse = () => ({
    sourceCount: 5,
    copiedCount: 0,
    skippedCount: 0,
    overwrite: false,
    dryRun: true,
    preview: {
      summary: {
        source_count: 5,
        create_count: 2,
        update_count: 0,
        skip_existing_count: 0,
        apply_count: 2,
      },
      rows: [
        {
          action: 'create' as const,
          drug_master_id: 'drug_c',
          reorder_point: null,
          preferred_generic_id: null,
          drug_master: { id: 'drug_c', yj_code: '999999999999', drug_name: 'コピー薬' },
        },
      ],
    },
  });

  const makeBulkServerResponse = (rowCount = 1) => ({
    importedCount: 0,
    unmatchedRows: [] as Array<{ rowNumber: number; yj_code?: string; drug_name?: string }>,
    invalidRows: [] as Array<{ rowNumber: number; reason: string }>,
    preview: {
      summary: {
        totalRows: rowCount,
        processableRows: rowCount,
        createCount: rowCount,
        updateCount: 0,
        deactivateCount: 0,
        noChangeCount: 0,
        unmatchedCount: 0,
        invalidCount: 0,
      },
      rows: Array.from({ length: rowCount }, (_, index) => ({
        rowNumber: index + 1,
        status: 'create' as const,
        yj_code: `2222222222${String(index).padStart(2, '0')}`,
        drug_name: `CSV薬${index + 1}`,
      })),
    },
  });

  const makeBulkServerResponseWithCandidate = () => ({
    importedCount: 0,
    unmatchedRows: [] as Array<{ rowNumber: number; yj_code?: string; drug_name?: string }>,
    invalidRows: [] as Array<{ rowNumber: number; reason: string }>,
    preview: {
      summary: {
        totalRows: 1,
        processableRows: 1,
        createCount: 0,
        updateCount: 0,
        deactivateCount: 0,
        noChangeCount: 0,
        unmatchedCount: 1,
        invalidCount: 0,
      },
      rows: [
        {
          rowNumber: 1,
          status: 'unmatched' as const,
          yj_code: '444444444444',
          drug_name: 'CSV未照合薬',
          candidates: [
            {
              id: 'candidate_1',
              yj_code: '555555555555',
              drug_name: '候補薬A',
              generic_name: 'ロキソプロフェン',
            },
          ],
        },
      ],
    },
  });

  async function renderBulkPreviewCandidateCopyButton() {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByLabelText('CSV一括登録'), {
      target: { value: '444444444444,CSV未照合薬,1,,,' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    const stamped = await runCapturedDryRun(makeBulkServerResponseWithCandidate());
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });

    return screen.getByRole('button', { name: '候補薬AのYJコードをコピー' });
  }

  // Stub global.fetch to return the given server JSON, execute the REAL captured mutationFn so the
  // production request-context stamping runs against the live controls/request body, then return
  // its stamped result (to be fed into onSuccess). This exercises R3.
  async function runCapturedDryRun(serverJson: unknown, vars?: unknown) {
    const options = lastMutationOptions.current;
    if (!options?.mutationFn) throw new Error('no captured mutationFn');
    const fetchMock = vi.fn(async () => jsonResponse(serverJson, 200));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    try {
      return await options.mutationFn(vars);
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it('updates state when the target-site combobox value changes (#1)', () => {
    render(<DrugMasterContent variant="formulary" />);

    const target = screen.getByRole('combobox', { name: '採用品設定の対象拠点' });
    fireEvent.change(target, { target: { value: 'site_2' } });

    expect(screen.getByText('コピー先: 支店')).toBeTruthy();
  });

  it('updates state when the copy-source combobox value changes (#2)', () => {
    render(<DrugMasterContent variant="formulary" />);

    const copyButton = screen.getByRole('button', { name: /コピー差分確認/ });
    expect(copyButton).toHaveProperty('disabled', true);

    // Target defaults to the first site (site_1), so the copy-source list excludes it; site_2 is
    // the available source option.
    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: 'site_2' },
    });

    expect(screen.getByRole('button', { name: /コピー差分確認/ })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('updates state when the template combobox value changes (#3)', () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });

    expect(screen.getByRole('button', { name: '在宅内科 標準セット（12件） を削除' })).toBeTruthy();
  });

  it('keeps the >=44px touch-target contract on migrated triggers and items', () => {
    render(<DrugMasterContent variant="formulary" />);

    for (const name of ['採用品設定の対象拠点', 'コピー元拠点', '適用する採用品テンプレート']) {
      const trigger = screen.getByRole('combobox', { name });
      expect(trigger.className).toContain('min-h-[44px]');
      expect(trigger.className).toContain('sm:min-h-[44px]');
    }

    // The mock never injects min-h; every captured SelectItem className must carry it on its own,
    // including the clear sentinel item.
    const sentinelItem = capturedSelectItems.find((item) => item.value === '__none__');
    const normalItem = capturedSelectItems.find((item) => item.value === 'template_1');
    expect(sentinelItem?.className).toContain('min-h-[44px]');
    expect(normalItem?.className).toContain('min-h-[44px]');
  });

  it('disables copy actions again when the copy source is cleared (#2)', () => {
    render(<DrugMasterContent variant="formulary" />);

    const copyCombobox = screen.getByRole('combobox', { name: 'コピー元拠点' });
    fireEvent.change(copyCombobox, { target: { value: 'site_2' } });
    expect(screen.getByRole('button', { name: /コピー差分確認/ })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.getByRole('button', { name: /採用品をコピー/ })).toHaveProperty(
      'disabled',
      false,
    );

    // Choose the explicit clear sentinel.
    fireEvent.change(copyCombobox, { target: { value: '__none__' } });

    expect(screen.getByRole('button', { name: /コピー差分確認/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /採用品をコピー/ })).toHaveProperty('disabled', true);
  });

  it('gates template apply on selection and clears back to disabled (#3)', () => {
    render(<DrugMasterContent variant="formulary" />);

    const templateCombobox = screen.getByRole('combobox', { name: '適用する採用品テンプレート' });
    expect(screen.getByRole('button', { name: /適用差分確認/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /テンプレートを適用/ })).toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.change(templateCombobox, { target: { value: 'template_1' } });
    expect(screen.getByRole('button', { name: /適用差分確認/ })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: /テンプレートを適用/ })).toHaveProperty(
      'disabled',
      false,
    );

    fireEvent.change(templateCombobox, { target: { value: '__none__' } });
    expect(screen.getByRole('button', { name: /適用差分確認/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /テンプレートを適用/ })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('does not fire the delete mutation before confirmation and clears selection delete gating (#3)', () => {
    render(<DrugMasterContent variant="formulary" />);

    const templateCombobox = screen.getByRole('combobox', { name: '適用する採用品テンプレート' });
    fireEvent.change(templateCombobox, { target: { value: 'template_1' } });

    fireEvent.click(screen.getByRole('button', { name: '在宅内科 標準セット（12件） を削除' }));
    expect(mutationMutateMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole('alertdialog', { name: '採用品テンプレートを削除しますか' }),
    ).toBeTruthy();
  });

  it('clears the template-apply preview when the target site changes (#1 mandatory)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));

    // Run the REAL mutationFn (stamps context from live controls) then feed its result to onSuccess.
    const stamped = await runCapturedDryRun(makeTemplateServerResponse(), { dryRun: true });
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });
    expect(screen.getByText('テンプレ薬')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: '採用品設定の対象拠点' }), {
      target: { value: 'site_2' },
    });

    expect(screen.queryByText('テンプレ薬')).toBeNull();
  });

  it('clears the CSV bulk preview when the target site changes (#1 mandatory)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    const csv = '222222222200,CSV薬1,1,,,';
    fireEvent.change(screen.getByLabelText('CSV一括登録'), {
      target: { value: csv },
    });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));

    const stamped = await runCapturedDryRun(makeBulkServerResponse());
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });
    expect(screen.getByText('CSV反映前プレビュー')).toBeTruthy();
    expect(screen.getByText('反映可能')).toBeTruthy();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', false);

    fireEvent.change(screen.getByRole('combobox', { name: '採用品設定の対象拠点' }), {
      target: { value: 'site_2' },
    });

    expect(screen.queryByText('CSV反映前プレビュー')).toBeNull();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', true);
  });

  // R3 — the production mutationFn must stamp the request-context from the live controls.
  it('stamps the live request-context onto each dry-run mutationFn result (R3)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    // Template dry-run: target site_1 (default), template_1, overwrite false.
    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));
    const templateStamped = (await runCapturedDryRun(makeTemplateServerResponse(), {
      dryRun: true,
    })) as Record<string, unknown>;
    expect(templateStamped.requestTargetSiteId).toBe('site_1');
    expect(templateStamped.requestTemplateId).toBe('template_1');
    expect(templateStamped.requestOverwrite).toBe(false);

    // Copy dry-run: target site_1, source site_2, overwrite false.
    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: 'site_2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /コピー差分確認/ }));
    const copyStamped = (await runCapturedDryRun(makeCopyServerResponse(), {
      dryRun: true,
    })) as Record<string, unknown>;
    expect(copyStamped.requestTargetSiteId).toBe('site_1');
    expect(copyStamped.requestSourceSiteId).toBe('site_2');
    expect(copyStamped.requestOverwrite).toBe(false);

    // Bulk dry-run: target site_1, the live CSV.
    const csv = '222222222200,CSV薬1,1,,,';
    fireEvent.change(screen.getByLabelText('CSV一括登録'), { target: { value: csv } });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    const bulkStamped = (await runCapturedDryRun(makeBulkServerResponse())) as Record<
      string,
      unknown
    >;
    expect(bulkStamped.requestTargetSiteId).toBe('site_1');
    expect(bulkStamped.requestCsv).toBe(csv);
  });

  // REQUIRED 1 — P1 medical safety / R3: a stale in-flight dry-run from the PREVIOUS context must
  // NOT restore a preview. Context is changed and the OLD onSuccess is invoked IMMEDIATELY with no
  // reliance on any passive effect flush between the change and the onSuccess.
  it('ignores a stale template-apply preview that resolves after the target changed (#1 safety, same-turn)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));
    // Stamp against site_1 (live controls) BEFORE the target changes.
    const stamped = await runCapturedDryRun(makeTemplateServerResponse(), { dryRun: true });

    // R1 teeth: the stale onSuccess fires in the SAME turn as the target change (inside the select
    // onChange, after the handler's synchronous ref write, before any passive-effect flush). If the
    // synchronous write is removed, only the (not-yet-flushed) useEffect backstop would run and the
    // stale preview WOULD render — so this test fails without the load-bearing sync write.
    afterSelectChangeHook.current = () => lastMutationOptions.current?.onSuccess?.(stamped);
    fireEvent.change(screen.getByRole('combobox', { name: '採用品設定の対象拠点' }), {
      target: { value: 'site_2' },
    });

    expect(screen.queryByText('テンプレ薬')).toBeNull();
  });

  it('ignores a stale CSV bulk preview that resolves after the target changed (#1 safety, same-turn)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    const csv = '222222222200,CSV薬1,1,,,';
    fireEvent.change(screen.getByLabelText('CSV一括登録'), { target: { value: csv } });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    const stamped = await runCapturedDryRun(makeBulkServerResponse());

    // R1 teeth: stale onSuccess fires in the same turn as the target change (before effect flush).
    afterSelectChangeHook.current = () => lastMutationOptions.current?.onSuccess?.(stamped);
    fireEvent.change(screen.getByRole('combobox', { name: '採用品設定の対象拠点' }), {
      target: { value: 'site_2' },
    });

    expect(screen.queryByText('CSV反映前プレビュー')).toBeNull();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', true);
  });

  it('ignores a stale copy preview that resolves after the copy source changed (#2 safety, same-turn)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    // Target defaults to site_1; copy source can be site_2 only.
    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: 'site_2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /コピー差分確認/ }));
    const stamped = await runCapturedDryRun(makeCopyServerResponse(), { dryRun: true });

    // R1 teeth: stale onSuccess fires in the same turn the copy source is cleared (before effect
    // flush), so the synchronous copySourceSiteIdRef write in the handler is what rejects it.
    afterSelectChangeHook.current = () => lastMutationOptions.current?.onSuccess?.(stamped);
    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: '__none__' },
    });

    expect(screen.queryByText('コピー薬')).toBeNull();
    expect(screen.getByRole('button', { name: /採用品をコピー/ })).toHaveProperty('disabled', true);
  });

  // REQUIRED 2 / R2 — overwrite is part of the request body and clears previews; a dry-run started
  // with overwrite=false that resolves after the user toggles overwrite=true must be discarded.
  it('ignores a stale copy preview after the overwrite toggle changed (#2 overwrite safety)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: 'site_2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /コピー差分確認/ }));
    // Stamp with overwrite=false (live control state).
    const stamped = await runCapturedDryRun(makeCopyServerResponse(), { dryRun: true });

    // Toggle overwrite (handler syncs overwriteRef synchronously).
    fireEvent.click(screen.getByLabelText('既存の採用品設定を上書き'));

    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });

    expect(screen.queryByText('コピー薬')).toBeNull();
  });

  it('ignores a stale template-apply preview after the overwrite toggle changed (#3 overwrite safety)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));
    const stamped = await runCapturedDryRun(makeTemplateServerResponse(), { dryRun: true });

    fireEvent.click(screen.getByLabelText('既存の採用品設定を上書き'));

    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });

    expect(screen.queryByText('テンプレ薬')).toBeNull();
  });

  it('renders a fresh copy preview only when the request context still matches (#2)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: 'site_2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /コピー差分確認/ }));

    const stamped = await runCapturedDryRun(makeCopyServerResponse(), { dryRun: true });
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });

    expect(screen.getByText('コピー薬')).toBeTruthy();
  });

  // rev3 R1/PI-012 — non-combobox reset paths that clear selectedTemplateId/bulkCsv must also sync
  // the paired ref (via the applySelectedTemplateId/applyBulkCsv helpers), so a stale dry-run
  // onSuccess resolving immediately after the reset cannot restore the cleared preview.
  it('ignores a stale template preview after the テンプレート検索 input clears the selection (R1)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));
    const stamped = await runCapturedDryRun(makeTemplateServerResponse(), { dryRun: true });

    // R1 teeth: dispatch the search-input change (which runs applySelectedTemplateId('') synchronously
    // in its onChange) and the stale onSuccess in the SAME act turn, before any passive-effect flush.
    const searchInput = screen.getByLabelText('採用品テンプレート検索') as HTMLInputElement;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    act(() => {
      nativeValueSetter?.call(searchInput, '在宅');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      lastMutationOptions.current?.onSuccess?.(stamped);
    });

    expect(screen.queryByText('テンプレ薬')).toBeNull();
  });

  it('ignores a stale template preview after deleteTemplate success clears the selection (R1)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));
    const stamped = await runCapturedDryRun(makeTemplateServerResponse(), { dryRun: true });
    // Capture the apply-preview onSuccess BEFORE the delete flow overwrites lastMutationOptions.
    const applyOnSuccess = lastMutationOptions.current?.onSuccess;

    // Drive the real delete flow: open confirm dialog, confirm → deleteTemplate.mutate() records
    // its options; its onSuccess calls applySelectedTemplateId('') (syncs the ref).
    fireEvent.click(screen.getByRole('button', { name: '在宅内科 標準セット（12件） を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    const deleteOnSuccess = lastMutationOptions.current?.onSuccess;

    // R1 teeth: the delete success handler resets selectedTemplateId SYNCHRONOUSLY (via
    // applySelectedTemplateId, before it awaits invalidateQueries). Invoke it, then the stale
    // apply-preview onSuccess, both in the SAME synchronous act turn with NO await between — so no
    // passive effect flushes in between and only the synchronous ref write can reject the stale
    // preview. (We deliberately do not await the delete promise before the stale onSuccess.)
    await act(async () => {
      const deletePromise = deleteOnSuccess?.({ deleted: true });
      applyOnSuccess?.(stamped);
      await deletePromise;
    });

    expect(screen.queryByText('テンプレ薬')).toBeNull();
  });

  it('ignores a stale CSV bulk preview after bulkImport success clears the CSV (R1)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    const csv = '222222222200,CSV薬1,1,,,';
    fireEvent.change(screen.getByLabelText('CSV一括登録'), { target: { value: csv } });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    const stamped = await runCapturedDryRun(makeBulkServerResponse());
    const previewOnSuccess = lastMutationOptions.current?.onSuccess;

    // Render a fresh preview first so 一括登録 is enabled.
    act(() => {
      previewOnSuccess?.(stamped);
    });
    fireEvent.click(screen.getByRole('button', { name: /一括登録/ }));
    const importOnSuccess = lastMutationOptions.current?.onSuccess;

    // R1 teeth: the import success handler resets bulkCsv SYNCHRONOUSLY (via applyBulkCsv, before it
    // awaits invalidateQueries). Invoke it, then re-fire the stale preview onSuccess, both in the
    // SAME synchronous act turn with NO await between — only the synchronous ref write can reject it.
    await act(async () => {
      const importPromise = importOnSuccess?.({
        importedCount: 1,
        unmatchedRows: [],
        invalidRows: [],
      });
      previewOnSuccess?.(stamped);
      await importPromise;
    });

    expect(screen.queryByText('CSV反映前プレビュー')).toBeNull();
  });

  // rev4 R2 — same-page preview invalidation on master data change: a master import/auto-refresh
  // changes the drug master that previews were computed against, so the import/auto-refresh success
  // handlers must clear copy/template/bulk previews. Bulk is most safety-critical because its apply
  // is gated by local canApplyBulkPreview, so a stale bulkPreview would otherwise stay actionable.
  it('clears the bulk preview and disables 一括登録 after a master import succeeds (R2)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    const csv = '222222222200,CSV薬1,1,,,';
    fireEvent.change(screen.getByLabelText('CSV一括登録'), { target: { value: csv } });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    const stamped = await runCapturedDryRun(makeBulkServerResponse());
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });
    expect(screen.getByText('CSV反映前プレビュー')).toBeTruthy();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', false);

    // Drive a master import: clicking records importMutation options; invoke its onSuccess.
    confirmMasterImportAction();
    await act(async () => {
      await lastMutationOptions.current?.onSuccess?.({
        action: 'ssk',
        definition: { label: 'SSK全件取込' },
        response: { data: { importedCount: 1, entryName: 'ssk' } },
      });
    });

    expect(screen.queryByText('CSV反映前プレビュー')).toBeNull();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', true);
  });

  it('clears the bulk preview and disables 一括登録 after the auto-refresh job succeeds (R2)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    const csv = '222222222200,CSV薬1,1,,,';
    fireEvent.change(screen.getByLabelText('CSV一括登録'), { target: { value: csv } });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    const stamped = await runCapturedDryRun(makeBulkServerResponse());
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });
    expect(screen.getByText('CSV反映前プレビュー')).toBeTruthy();

    confirmAutoRefreshAction();
    await act(async () => {
      await lastMutationOptions.current?.onSuccess?.({ data: { processedCount: 3 } });
    });

    expect(screen.queryByText('CSV反映前プレビュー')).toBeNull();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', true);
  });

  it('clears copy and template previews after a master import succeeds (R2)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    // Render a copy preview.
    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: 'site_2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /コピー差分確認/ }));
    const copyStamped = await runCapturedDryRun(makeCopyServerResponse(), { dryRun: true });
    act(() => {
      lastMutationOptions.current?.onSuccess?.(copyStamped);
    });
    expect(screen.getByText('コピー薬')).toBeTruthy();

    // Render a template preview.
    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));
    const templateStamped = await runCapturedDryRun(makeTemplateServerResponse(), { dryRun: true });
    act(() => {
      lastMutationOptions.current?.onSuccess?.(templateStamped);
    });
    expect(screen.getByText('テンプレ薬')).toBeTruthy();

    // Master import clears both previews.
    confirmMasterImportAction();
    await act(async () => {
      await lastMutationOptions.current?.onSuccess?.({
        action: 'ssk',
        definition: { label: 'SSK全件取込' },
        response: { data: { importedCount: 1, entryName: 'ssk' } },
      });
    });

    expect(screen.queryByText('コピー薬')).toBeNull();
    expect(screen.queryByText('テンプレ薬')).toBeNull();
  });

  it('clears copy and template previews after the auto-refresh job succeeds (R2)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: 'site_2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /コピー差分確認/ }));
    const copyStamped = await runCapturedDryRun(makeCopyServerResponse(), { dryRun: true });
    act(() => {
      lastMutationOptions.current?.onSuccess?.(copyStamped);
    });
    expect(screen.getByText('コピー薬')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: '適用する採用品テンプレート' }), {
      target: { value: 'template_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /適用差分確認/ }));
    const templateStamped = await runCapturedDryRun(makeTemplateServerResponse(), { dryRun: true });
    act(() => {
      lastMutationOptions.current?.onSuccess?.(templateStamped);
    });
    expect(screen.getByText('テンプレ薬')).toBeTruthy();

    confirmAutoRefreshAction();
    await act(async () => {
      await lastMutationOptions.current?.onSuccess?.({ data: { processedCount: 3 } });
    });

    expect(screen.queryByText('コピー薬')).toBeNull();
    expect(screen.queryByText('テンプレ薬')).toBeNull();
  });

  // rev5 R1 — previews must be cleared SYNCHRONOUSLY, BEFORE the invalidateQueries await resolves,
  // so a slow refetch cannot leave a stale bulk preview visible + 一括登録 enabled in the meantime.
  // We hold invalidateQueries pending (never resolve it) and assert the preview is already gone.
  it('clears the bulk preview before invalidation resolves on import success (R1 ordering)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    const csv = '222222222200,CSV薬1,1,,,';
    fireEvent.change(screen.getByLabelText('CSV一括登録'), { target: { value: csv } });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    const stamped = await runCapturedDryRun(makeBulkServerResponse());
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });
    expect(screen.getByText('CSV反映前プレビュー')).toBeTruthy();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', false);

    // Hold invalidation PENDING (never resolves) so we observe the state between sync clear + await.
    let resolveInvalidate: (() => void) | undefined;
    invalidateQueriesMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInvalidate = resolve;
        }),
    );

    confirmMasterImportAction();
    act(() => {
      // onSuccess runs the synchronous preview clears, then awaits the (pending) invalidation.
      void lastMutationOptions.current?.onSuccess?.({
        action: 'ssk',
        definition: { label: 'SSK全件取込' },
        response: { data: { importedCount: 1, entryName: 'ssk' } },
      });
    });

    // Invalidation is still pending, yet the preview must already be gone and apply disabled.
    expect(screen.queryByText('CSV反映前プレビュー')).toBeNull();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', true);
    resolveInvalidate?.();
  });

  it('clears the bulk preview before invalidation resolves on auto-refresh success (R1 ordering)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    const csv = '222222222200,CSV薬1,1,,,';
    fireEvent.change(screen.getByLabelText('CSV一括登録'), { target: { value: csv } });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    const stamped = await runCapturedDryRun(makeBulkServerResponse());
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });
    expect(screen.getByText('CSV反映前プレビュー')).toBeTruthy();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', false);

    let resolveInvalidate: (() => void) | undefined;
    invalidateQueriesMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInvalidate = resolve;
        }),
    );

    confirmAutoRefreshAction();
    act(() => {
      void lastMutationOptions.current?.onSuccess?.({ data: { processedCount: 3 } });
    });

    expect(screen.queryByText('CSV反映前プレビュー')).toBeNull();
    expect(screen.getByRole('button', { name: /一括登録/ })).toHaveProperty('disabled', true);
    resolveInvalidate?.();
  });

  // REQUIRED 2 — lock the COMPLETE #1 reset contract: copy-source reset + copy preview clear +
  // expanded bulk preview cannot survive a target change.
  it('re-disables copy actions and clears a copy preview on target change, proving setCopySourceSiteId("") + setCopyPreview(null) (#1 contract)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: 'コピー元拠点' }), {
      target: { value: 'site_2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /コピー差分確認/ }));
    const stamped = await runCapturedDryRun(makeCopyServerResponse(), { dryRun: true });
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });
    expect(screen.getByText('コピー薬')).toBeTruthy();
    expect(screen.getByRole('button', { name: /採用品をコピー/ })).toHaveProperty(
      'disabled',
      false,
    );

    // Target change must reset copy source ('') AND clear the copy preview.
    fireEvent.change(screen.getByRole('combobox', { name: '採用品設定の対象拠点' }), {
      target: { value: 'site_2' },
    });

    expect(screen.queryByText('コピー薬')).toBeNull();
    expect(screen.getByRole('button', { name: /コピー差分確認/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /採用品をコピー/ })).toHaveProperty('disabled', true);
  });

  it('discards an EXPANDED bulk preview on target change, proving setBulkPreview(null) + setBulkPreviewExpanded(false) (#1 contract)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    const csv = 'many rows csv';
    fireEvent.change(screen.getByLabelText('CSV一括登録'), { target: { value: csv } });
    fireEvent.click(screen.getByRole('button', { name: /^差分確認$/ }));
    const stamped = await runCapturedDryRun(makeBulkServerResponse(8));
    act(() => {
      lastMutationOptions.current?.onSuccess?.(stamped);
    });
    expect(screen.getByText('CSV反映前プレビュー')).toBeTruthy();

    // Expand the >6-row preview.
    fireEvent.click(screen.getByRole('button', { name: /全8件を表示/ }));
    expect(screen.getByText('CSV薬8')).toBeTruthy();

    // Target change discards the expanded preview entirely.
    fireEvent.change(screen.getByRole('combobox', { name: '採用品設定の対象拠点' }), {
      target: { value: 'site_2' },
    });
    expect(screen.queryByText('CSV反映前プレビュー')).toBeNull();
    expect(screen.queryByText('CSV薬8')).toBeNull();
    expect(screen.queryByRole('button', { name: /件を表示/ })).toBeNull();
  });

  it('copies a bulk-preview candidate YJ code only after clipboard write succeeds', async () => {
    const copyButton = await renderBulkPreviewCandidateCopyButton();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('YJコードをコピーしました');
    });
    expect(writeText).toHaveBeenCalledWith('555555555555');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('does not show a false success toast when Clipboard API is unavailable', async () => {
    const copyButton = await renderBulkPreviewCandidateCopyButton();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('クリップボードにコピーできませんでした');
    });
    expect(toastSuccessMock).not.toHaveBeenCalledWith('YJコードをコピーしました');
  });

  it('does not expose raw clipboard rejection text when candidate YJ copy fails', async () => {
    const copyButton = await renderBulkPreviewCandidateCopyButton();
    const writeText = vi.fn().mockRejectedValue(new Error('raw browser permission detail'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('クリップボードにコピーできませんでした');
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith('raw browser permission detail');
    expect(toastSuccessMock).not.toHaveBeenCalledWith('YJコードをコピーしました');
  });

  // REQUIRED 3 — explicit clear sentinels for #2/#3 exist as real options with value '__none__'.
  it('exposes explicit clear sentinels for copy-source and template (#2/#3)', () => {
    render(<DrugMasterContent variant="formulary" />);

    const copyClear = screen.getByRole('option', {
      name: 'コピー元拠点を未選択に戻す',
    }) as HTMLOptionElement;
    const templateClear = screen.getByRole('option', {
      name: 'テンプレートを未選択に戻す',
    }) as HTMLOptionElement;
    expect(copyClear.value).toBe('__none__');
    expect(templateClear.value).toBe('__none__');

    // The mock placeholder must not mask a missing sentinel SelectItem: assert the captured
    // SOURCE items contain EXACTLY the two __none__ sentinels with their labels.
    const sentinelItems = capturedSelectItems.filter((item) => item.value === '__none__');
    const sentinelLabels = sentinelItems
      .map((item) => flattenLabel(item.children))
      .sort((a, b) => a.localeCompare(b));
    expect(sentinelItems).toHaveLength(2);
    expect(sentinelLabels).toEqual(
      ['コピー元拠点を未選択に戻す', 'テンプレートを未選択に戻す'].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
  });

  // REQUIRED 4 / R3 — every migrated SelectItem carries min-h-[44px] in its SOURCE className,
  // asserted PER-Select so target-site/site_2 and copy-source/site_2 are checked INDEPENDENTLY
  // (one Select's capture cannot satisfy another Select's assertion).
  it('keeps min-h-[44px] on ALL migrated SelectItems, per Select (#1/#2/#3)', () => {
    render(<DrugMasterContent variant="formulary" />);

    // selectKey = trigger id (#1/#2) or aria-label (#3).
    const expected: Array<{ selectKey: string; value: unknown; label: string }> = [
      { selectKey: 'drug-master-target-site', value: 'site_1', label: '本店' }, // target-site (#1)
      { selectKey: 'drug-master-target-site', value: 'site_2', label: '支店' }, // target-site (#1)
      {
        selectKey: 'drug-master-copy-source',
        value: '__none__',
        label: 'コピー元拠点を未選択に戻す',
      }, // copy clear (#2)
      { selectKey: 'drug-master-copy-source', value: 'site_2', label: '支店' }, // copy source (#2)
      {
        selectKey: '適用する採用品テンプレート',
        value: '__none__',
        label: 'テンプレートを未選択に戻す',
      }, // template clear (#3)
      {
        selectKey: '適用する採用品テンプレート',
        value: 'template_1',
        label: '在宅内科 標準セット（12件）',
      }, // template item (#3)
    ];

    for (const { selectKey, value, label } of expected) {
      const match = capturedSelectItems.find(
        (item) =>
          item.selectKey === selectKey &&
          item.value === value &&
          flattenLabel(item.children) === label,
      );
      expect(
        match,
        `missing migrated SelectItem ${selectKey} / ${String(value)} / ${label}`,
      ).toBeTruthy();
      expect(match?.className).toContain('min-h-[44px]');
    }

    // Explicitly prove target-site/site_2 and copy-source/site_2 are SEPARATE captures (R3): a
    // copy-source site_2 losing min-h must not be masked by the target-site site_2 capture.
    const site2Captures = capturedSelectItems.filter(
      (item) => item.value === 'site_2' && flattenLabel(item.children) === '支店',
    );
    const site2SelectKeys = new Set(site2Captures.map((item) => item.selectKey));
    expect(site2SelectKeys.has('drug-master-target-site')).toBe(true);
    expect(site2SelectKeys.has('drug-master-copy-source')).toBe(true);

    // No migrated item is missing the touch-target class.
    expect(capturedSelectItems.every((item) => item.className?.includes('min-h-[44px]'))).toBe(
      true,
    );
  });
});

describe('DrugMasterContent filter select migration (slice4b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    pendingRequestsMock.mockReturnValue([]);
    mutationMutateMock.mockClear();
    lastMutationOptions.current = null;
    capturedSelectItems.length = 0;
    capturedQueryKeys.length = 0;
    capturedQueryOptions.length = 0;
    afterSelectChangeHook.current = null;
    invalidateQueriesMock.mockReset();
    invalidateQueriesMock.mockImplementation(async () => undefined);
    detailDataMock.current = null;
    stockConfigDataMock.current = null;
    candidatesDataMock.current = [];
    genericRecommendationsDataMock.current = [];
    ingredientGroupDataMock.current = null;
    importLogsDataMock.current = [];
  });

  // The import-logs queryKey is ['drug-master-import-logs', <source>, <status>]. We assert the
  // LATEST captured key (the render after the Select change) reflects the new filter state —
  // state+queryKey, not DOM-only.
  function latestImportLogsKey(): ReadonlyArray<unknown> {
    const matches = capturedQueryKeys.filter((key) => key[0] === 'drug-master-import-logs');
    return matches[matches.length - 1] ?? [];
  }

  // The drug-masters queryKey is ['drug-masters', orgId, params] where params is the encoded
  // URLSearchParams string (category lives there).
  function latestDrugMastersParams(): string {
    const matches = capturedQueryKeys.filter((key) => key[0] === 'drug-masters');
    return (matches[matches.length - 1]?.[2] as string) ?? '';
  }

  it('reflects the new source on the import-logs queryKey when ソース changes (#5)', () => {
    render(<DrugMasterContent variant="formulary" />);

    expect(latestImportLogsKey()).toEqual(['drug-master-import-logs', 'all', 'all']);

    fireEvent.change(screen.getByRole('combobox', { name: '取込履歴ソース' }), {
      target: { value: 'pmda' },
    });

    expect(latestImportLogsKey()).toEqual(['drug-master-import-logs', 'pmda', 'all']);
  });

  it('reflects the new status on the import-logs queryKey when 状態 changes (#6)', () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: '取込履歴状態' }), {
      target: { value: 'failed' },
    });

    expect(latestImportLogsKey()).toEqual(['drug-master-import-logs', 'all', 'failed']);
  });

  it('adds then removes the category param on the drug-masters queryKey via 薬効分類フィルタ (#7)', () => {
    render(<DrugMasterContent variant="formulary" />);

    // Default '' (全薬効分類) → no category param.
    expect(new URLSearchParams(latestDrugMastersParams()).get('category')).toBeNull();

    const categoryCombobox = screen.getByRole('combobox', { name: '薬効分類フィルタ' });
    fireEvent.change(categoryCombobox, { target: { value: '3' } });
    expect(new URLSearchParams(latestDrugMastersParams()).get('category')).toBe('3');

    // Back to '' (全薬効分類) must be reselectable and must drop the param (Base UI keeps value=''
    // selectable under a controlled '' value; it is NOT collapsed to a placeholder).
    fireEvent.change(categoryCombobox, { target: { value: '' } });
    expect(new URLSearchParams(latestDrugMastersParams()).get('category')).toBeNull();
  });

  // W2-F2 実バグ回帰: /api/drug-masters は cursor pagination（limit=50, hasMore, nextCursor）
  // 対応済みなのに、UI が初回 50 件のみ表示し 51 件目以降を捨てていた。useInfiniteQuery で
  // 累積し、hasMore/onLoadMore を DataTable に配線したことを検証する。
  it('wires cursor pagination hasMore + onLoadMore into the DataTable and fetches the next page (W2-F2)', () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => ({ id: `drug_${i}` }));
    drugMastersPagesMock.current = [
      { data: firstPage, totalCount: 123, hasMore: true, nextCursor: '50' },
    ];

    render(<DrugMasterContent />);

    const props = dataTablePropsMock.current;
    expect(props).not.toBeNull();
    // 1 ページ目の 50 件が DataTable に渡る。
    expect((props?.data as unknown[]).length).toBe(50);
    // まだ続きがあるので load-more が有効化される（これがないと 51 件目以降が見えない）。
    expect(props?.hasMore).toBe(true);
    expect(typeof props?.onLoadMore).toBe('function');

    // 「さらに表示」相当のトリガで次ページ取得が走る。
    (props?.onLoadMore as () => void)();
    expect(fetchNextDrugMastersMock).toHaveBeenCalledTimes(1);
  });

  it('accumulates rows across cursor pages so results beyond the first 50 remain visible (W2-F2)', () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => ({ id: `drug_${i}` }));
    const secondPage = Array.from({ length: 7 }, (_, i) => ({ id: `drug_${50 + i}` }));
    drugMastersPagesMock.current = [
      { data: firstPage, totalCount: 57, hasMore: true, nextCursor: '50' },
      { data: secondPage, totalCount: 57, hasMore: false, nextCursor: undefined },
    ];

    render(<DrugMasterContent />);

    const props = dataTablePropsMock.current;
    const rows = props?.data as Array<{ id: string }>;
    // 2 ページ分（50 + 7）が累積されて渡る。
    expect(rows.length).toBe(57);
    expect(rows[0]?.id).toBe('drug_0');
    expect(rows[56]?.id).toBe('drug_56');
    // 全件取得済みなので load-more は無効。
    expect(props?.hasMore).toBe(false);
    // 登録件数は総数（累積表示件数ではなく server の totalCount）を表示する。
    expect(screen.getByText(/登録件数\s*57件/)).toBeTruthy();
  });

  it('carries purpose=audit on the export request when CSV出力用途=監査 (#4)', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.change(screen.getByRole('combobox', { name: 'CSV出力用途' }), {
      target: { value: 'audit' },
    });

    // Click 対象拠点全件CSV出力 to capture the export mutation options, then execute the REAL mutationFn
    // against a stubbed fetch so the production purpose stamping runs (not DOM-only).
    fireEvent.click(screen.getByRole('button', { name: /対象拠点全件CSV出力/ }));

    const options = lastMutationOptions.current;
    expect(options?.mutationFn).toBeTruthy();

    let requestedUrl = '';
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrl = url;
      return {
        ok: true,
        blob: async () => new Blob(['csv']),
      };
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    try {
      await options!.mutationFn!();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(requestedUrl).toContain('/api/pharmacy-drug-stocks/export');
    expect(new URL(requestedUrl, 'http://localhost').searchParams.get('purpose')).toBe('audit');
  });

  it('preserves JSON error messages for CSV blob endpoints without parsing success blobs as JSON', async () => {
    render(<DrugMasterContent variant="formulary" />);

    fireEvent.click(screen.getByRole('button', { name: /対象拠点全件CSV出力/ }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: '採用薬CSVは管理者のみ出力できます' }, 403)),
    );
    try {
      await expect(runCurrentMutation()).rejects.toThrow('採用薬CSVは管理者のみ出力できます');
    } finally {
      vi.unstubAllGlobals();
    }

    fireEvent.click(screen.getByRole('button', { name: /CSVテンプレート/ }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 500 })),
    );
    try {
      await expect(runCurrentMutation()).rejects.toThrow(
        '採用薬CSVテンプレートの取得に失敗しました',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps >=44px on all slice4b filter triggers (#4/#5/#6/#7)', () => {
    render(<DrugMasterContent variant="formulary" />);

    for (const name of ['CSV出力用途', '取込履歴ソース', '取込履歴状態', '薬効分類フィルタ']) {
      const trigger = screen.getByRole('combobox', { name });
      expect(trigger.className).toContain('min-h-[44px]');
      expect(trigger.className).toContain('sm:min-h-[44px]');
    }
  });

  it('exposes the migrated filter comboboxes by accessible name (#4/#5/#6/#7)', () => {
    render(<DrugMasterContent variant="formulary" />);

    expect(screen.getByRole('combobox', { name: 'CSV出力用途' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '取込履歴ソース' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '取込履歴状態' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '薬効分類フィルタ' })).toBeTruthy();
  });

  // PER-Select empty/clear contract via capturedSelectItems keyed by selectKey (the trigger
  // aria-label). #4/#5/#6 render their real options only — no '' value, no __none__ sentinel.
  // #7 MUST keep the '' 全薬効分類 item, with no __none__ sentinel.
  it('enforces the per-Select empty-option contract (#4/#5/#6 no empty, #7 keeps empty) ', () => {
    render(<DrugMasterContent variant="formulary" />);

    const itemsFor = (selectKey: string) =>
      capturedSelectItems.filter((item) => item.selectKey === selectKey);

    // #4 CSV出力用途: exactly the four purposes, no '' / no __none__.
    const exportValues = itemsFor('CSV出力用途')
      .map((item) => String(item.value))
      .sort();
    expect(exportValues).toEqual(['audit', 'operations', 'pharmacist_review', 'posting']);
    expect(exportValues).not.toContain('');
    expect(exportValues).not.toContain('__none__');

    // #5 取込履歴ソース: IMPORT_LOG_SOURCE_OPTIONS values (incl. non-empty 'all'), no '' / no __none__.
    const sourceValues = itemsFor('取込履歴ソース').map((item) => String(item.value));
    expect(sourceValues).toContain('all');
    expect(sourceValues).toContain('pmda');
    expect(sourceValues).not.toContain('');
    expect(sourceValues).not.toContain('__none__');

    // #6 取込履歴状態: IMPORT_LOG_STATUS_OPTIONS values (incl. non-empty 'all'), no '' / no __none__.
    const statusValues = itemsFor('取込履歴状態').map((item) => String(item.value));
    expect(statusValues).toContain('all');
    expect(statusValues).toContain('failed');
    expect(statusValues).not.toContain('');
    expect(statusValues).not.toContain('__none__');

    // #7 薬効分類フィルタ: MUST contain the '' 全薬効分類 item, no __none__ sentinel.
    const categoryItems = itemsFor('薬効分類フィルタ');
    const emptyCategory = categoryItems.find((item) => item.value === '');
    expect(emptyCategory, 'category Select must keep the value="" 全薬効分類 item').toBeTruthy();
    expect(flattenLabel(emptyCategory?.children)).toBe('全薬効分類');
    expect(emptyCategory?.className).toContain('min-h-[44px]');
    expect(categoryItems.map((item) => String(item.value))).not.toContain('__none__');
  });

  // CLOSED-TRIGGER LABEL CONTRACT (the bug codex found): the four migrated filter Selects must
  // pass an explicit SelectValue child so the closed trigger renders the Japanese label, never a
  // raw machine value (#4/#5/#6) or a blank (#7's value=""). The mock's `${selectKey}-display`
  // span reproduces Base UI's bare-SelectValue fallback, so a regression to `<SelectValue />`
  // would make these assertions fail.
  it('renders the human-readable label on the closed trigger for the four filter Selects', () => {
    render(<DrugMasterContent variant="formulary" />);

    const displayText = (selectKey: string) =>
      screen.getByTestId(`${selectKey}-display`).textContent;

    // #4 CSV出力用途: default 'operations' → 運用台帳, after change to 'audit' → 監査.
    expect(displayText('CSV出力用途')).toBe('運用台帳');
    fireEvent.change(screen.getByRole('combobox', { name: 'CSV出力用途' }), {
      target: { value: 'audit' },
    });
    expect(displayText('CSV出力用途')).toBe('監査');

    // #5 取込履歴ソース: default 'all' → すべてのソース, after change to 'pmda' → PMDA.
    expect(displayText('取込履歴ソース')).toBe('すべてのソース');
    fireEvent.change(screen.getByRole('combobox', { name: '取込履歴ソース' }), {
      target: { value: 'pmda' },
    });
    expect(displayText('取込履歴ソース')).toBe('PMDA');

    // #6 取込履歴状態: default 'all' → すべての状態, after change to 'failed' → 失敗のみ.
    expect(displayText('取込履歴状態')).toBe('すべての状態');
    fireEvent.change(screen.getByRole('combobox', { name: '取込履歴状態' }), {
      target: { value: 'failed' },
    });
    expect(displayText('取込履歴状態')).toBe('失敗のみ');

    // #7 薬効分類フィルタ: default '' → 全薬効分類, change to '3' → 3: 代謝性医薬品,
    // then back to '' → 全薬効分類 (the empty-string regression must not blank the trigger).
    const categoryCombobox = () => screen.getByRole('combobox', { name: '薬効分類フィルタ' });
    expect(displayText('薬効分類フィルタ')).toBe('全薬効分類');
    fireEvent.change(categoryCombobox(), { target: { value: '3' } });
    expect(displayText('薬効分類フィルタ')).toBe('3: 代謝性医薬品');
    fireEvent.change(categoryCombobox(), { target: { value: '' } });
    expect(displayText('薬効分類フィルタ')).toBe('全薬効分類');
  });
});

describe('DrugMasterContent preferred-generic select migration (slice4c)', () => {
  // A complete-enough DrugMasterDetail so the drug-detail panel (which hosts the 採用後発薬
  // Select) renders. generic_name is set so the panel's `generic_name || candidates>0` guard
  // passes and the candidate query is exercised.
  function buildDetail(): unknown {
    return {
      id: 'drug_1',
      yj_code: '9999999999',
      receipt_code: null,
      jan_code: null,
      drug_name: '先発薬A',
      drug_name_kana: null,
      generic_name: 'イブプロフェン',
      drug_price: 50,
      unit: '錠',
      dosage_form: null,
      therapeutic_category: null,
      manufacturer: null,
      is_generic: false,
      is_narcotic: false,
      is_psychotropic: false,
      is_high_risk: false,
      outpatient_injection_eligible: false,
      outpatient_injection_note: null,
      is_lasa_risk: false,
      tall_man_name: null,
      lasa_group_key: null,
      max_administration_days: null,
      stock_config: null,
      hot_code: null,
      transitional_expiry_date: null,
      package_inserts: [],
      interactions_as_a: [],
      interactions_as_b: [],
    };
  }

  // A stocked config whose preferred_generic display name covers the "saved id with no matching
  // candidate" fallback branch of selectedPreferredGenericLabel.
  function buildStockConfig(): unknown {
    return {
      id: 'stock_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      is_stocked: true,
      stock_qty: 10,
      reorder_point: 5,
      preferred_generic_id: null,
      adoption_source: null,
      adoption_note: null,
      last_reviewed_at: null,
      reviewed_by_id: null,
      follow_up_status: null,
      follow_up_reason: null,
      follow_up_due_date: null,
      follow_up_resolved_at: null,
      updated_at: '2026-05-27T00:00:00.000Z',
      preferred_generic: {
        id: 'gen_saved',
        drug_name: '保存済みジェネリック',
        yj_code: '0000000000',
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    pendingRequestsMock.mockReturnValue([]);
    mutationMutateMock.mockClear();
    lastMutationOptions.current = null;
    capturedSelectItems.length = 0;
    capturedQueryKeys.length = 0;
    capturedQueryOptions.length = 0;
    afterSelectChangeHook.current = null;
    invalidateQueriesMock.mockReset();
    invalidateQueriesMock.mockImplementation(async () => undefined);
    // Drive the detail panel open with a generic-name drug, a stocked config, and one candidate.
    detailDataMock.current = buildDetail();
    stockConfigDataMock.current = buildStockConfig();
    candidatesDataMock.current = [
      { id: 'gen_1', drug_name: 'ジェネリックA', yj_code: '1234567890' },
    ];
    genericRecommendationsDataMock.current = [];
    ingredientGroupDataMock.current = null;
    importLogsDataMock.current = [];
  });

  const display = () => screen.getByTestId('採用後発薬-display').textContent;
  const combobox = () => screen.getByRole('combobox', { name: '採用後発薬' });

  // (a) default closed-trigger label (effectivePreferredGenericId === '' → 指定しない) and
  // (e) the trigger carries aria-label 採用後発薬.
  it('renders 指定しない on the closed trigger by default and exposes the aria-label', () => {
    render(<DrugMasterContent />);

    expect(display()).toBe('指定しない');
    // aria-label resolves the combobox by accessible name, proving the trigger forwards it.
    expect(combobox()).toBeTruthy();
  });

  // (b) the value="" 指定しない SelectItem is present AND every item carries the >=44px
  // touch-target className on its SOURCE value (same assertion style as slice4b).
  it('keeps the value="" 指定しない item and min-h-[44px] on all 採用後発薬 items', () => {
    render(<DrugMasterContent />);

    const items = capturedSelectItems.filter((item) => item.selectKey === '採用後発薬');
    const noneItem = items.find((item) => item.value === '');
    expect(
      noneItem,
      'preferred-generic Select must keep the value="" 指定しない item',
    ).toBeTruthy();
    expect(flattenLabel(noneItem?.children)).toBe('指定しない');
    // No __none__ sentinel — '' is the real "指定しない" value (medical value-semantics contract).
    expect(items.map((item) => String(item.value))).not.toContain('__none__');

    const candidateItem = items.find((item) => item.value === 'gen_1');
    expect(candidateItem).toBeTruthy();
    expect(flattenLabel(candidateItem?.children)).toBe('ジェネリックA (1234567890)');

    for (const item of items) {
      expect(item.className).toContain('min-h-[44px]');
    }
  });

  // (c) selecting candidate gen_1 → closed trigger shows `drug_name (yj_code)`, and
  // (d) selecting back to '' → 指定しない again (empty-string must not blank the trigger).
  it('reflects the selected candidate label on the closed trigger and clears back to 指定しない', () => {
    render(<DrugMasterContent />);

    expect(display()).toBe('指定しない');

    fireEvent.change(combobox(), { target: { value: 'gen_1' } });
    expect(display()).toBe('ジェネリックA (1234567890)');

    fireEvent.change(combobox(), { target: { value: '' } });
    expect(display()).toBe('指定しない');
  });

  // (f) medical-safety regression (slice4c rev2): a saved preferred_generic_id that is non-empty,
  // not in the candidate list, AND has no saved preferred_generic.drug_name must NOT leak the raw
  // machine id onto the closed trigger — it must show the pharmacist-safe unresolved label instead.
  it('shows the unresolved label (not the raw id) when the saved 採用後発薬 id has no candidate or saved name', () => {
    // Stocked config: saved id 'gen_missing' with no embedded preferred_generic display name.
    stockConfigDataMock.current = {
      ...(buildStockConfig() as Record<string, unknown>),
      preferred_generic_id: 'gen_missing',
      preferred_generic: null,
    };
    // Candidates do NOT contain 'gen_missing' (only the resolvable gen_1), so no candidate match.
    candidatesDataMock.current = [
      { id: 'gen_1', drug_name: 'ジェネリックA', yj_code: '1234567890' },
    ];

    render(<DrugMasterContent />);

    // effectivePreferredGenericId resolves to 'gen_missing' from the stock config (no user pick).
    expect(display()).not.toBe('gen_missing');
    expect(display()).toBe('保存済みの採用後発薬を確認してください');
  });
});

describe('parseReorderPointInput', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['0', 0],
    ['10', 10],
    [' 720 ', 720],
  ])('accepts blank or non-negative integer input %s', (input, expected) => {
    expect(parseReorderPointInput(input)).toEqual({ ok: true, value: expected });
  });

  it.each(['-1', '10.5', '10abc', '1e2', 'Infinity', '9007199254740992'])(
    'rejects malformed reorder point input %s',
    (input) => {
      expect(parseReorderPointInput(input)).toEqual({ ok: false });
    },
  );
});

describe('DrugMasterContent supporting-query fetch-error handling', () => {
  const reviewDueQueryKey = 'pharmacy-drug-stocks|org_1|site_1|review-due';
  const missingReorderQueryKey = 'pharmacy-drug-stocks|org_1|site_1|missing-reorder';

  function queuePendingFormularyRequest(drugMasterId = 'drug_generic') {
    pendingRequestsMock.mockReturnValue([
      {
        id: 'request_1',
        site_id: 'site_1',
        drug_master_id: drugMasterId,
        status: 'pending',
        action_type: 'adopt',
        requested_payload: { is_stocked: true },
        reason: '新規採用候補',
        created_at: '2026-05-27T00:00:00.000Z',
      },
    ]);
  }

  function buildGenericDetail() {
    return {
      id: 'drug_generic',
      yj_code: '111111111111',
      receipt_code: null,
      jan_code: null,
      drug_name: '先発薬A',
      drug_name_kana: null,
      generic_name: 'ロキソプロフェン',
      drug_price: 17.1,
      unit: '錠',
      dosage_form: null,
      therapeutic_category: null,
      manufacturer: null,
      is_generic: false,
      is_narcotic: false,
      is_psychotropic: false,
      is_high_risk: false,
      outpatient_injection_eligible: false,
      outpatient_injection_note: null,
      is_lasa_risk: false,
      tall_man_name: null,
      lasa_group_key: null,
      max_administration_days: null,
      stock_config: null,
      hot_code: null,
      transitional_expiry_date: null,
      package_inserts: [],
      interactions_as_a: [],
      interactions_as_b: [],
    };
  }

  function buildReviewDueStock() {
    return {
      id: 'stock_review_due',
      site_id: 'site_1',
      drug_master_id: 'drug_review_due',
      is_stocked: true,
      stock_qty: null,
      reorder_point: null,
      preferred_generic_id: null,
      adoption_source: null,
      adoption_note: null,
      last_reviewed_at: '2025-01-01T00:00:00.000Z',
      reviewed_by_id: null,
      follow_up_status: null,
      follow_up_reason: null,
      follow_up_due_date: null,
      follow_up_resolved_at: null,
      updated_at: '2026-05-27T00:00:00.000Z',
      preferred_generic: null,
      drug_master: {
        id: 'drug_review_due',
        drug_name: 'レビュー対象薬',
        yj_code: '444444444444',
        drug_price: 12.3,
        unit: '錠',
        is_generic: false,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        transitional_expiry_date: null,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    pendingRequestsMock.mockReturnValue([]);
    detailDataMock.current = null;
    stockConfigDataMock.current = null;
    candidatesDataMock.current = [];
    genericRecommendationsDataMock.current = [];
    ingredientGroupDataMock.current = null;
    importLogsDataMock.current = [];
    capturedQueryOptions.length = 0;
    queryErrorKeys.clear();
    queryLoadingKeys.clear();
    staleQueryDataByKey.clear();
    refetchSpies.clear();
  });

  afterEach(() => {
    queryErrorKeys.clear();
    queryLoadingKeys.clear();
    staleQueryDataByKey.clear();
    refetchSpies.clear();
  });

  function expectUnsafeBackendDetailNotRendered() {
    for (const unsafeText of [
      '田中一郎',
      'storage_key',
      's3://phi-bucket/raw',
      'token=secret',
      'provider_error',
      'GET /api/',
    ]) {
      expect(screen.queryByText((content) => content.includes(unsafeText))).toBeNull();
    }
  }

  it('keeps API messages from failed core read queries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/pharmacy-sites') {
        return jsonResponse({ message: '拠点一覧を表示できません' }, 403);
      }
      if (url === '/api/drug-masters?limit=50&site_id=site_1&cursor=cursor_1') {
        return jsonResponse({ message: '医薬品マスターを表示できません' }, 403);
      }
      if (url === '/api/drug-master-imports/status') {
        return jsonResponse({ message: '取込ステータスを表示できません' }, 403);
      }
      if (url === '/api/drug-master-import-logs?limit=10') {
        return jsonResponse({ message: '取込履歴を表示できません' }, 403);
      }
      return jsonResponse({ message: `unexpected fetch: ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DrugMasterContent />);

    const sitesConfig = capturedQueryOptions.find(
      (config) => config.queryKey[0] === 'pharmacy-sites',
    );
    const drugMastersConfig = capturedQueryOptions.find(
      (config) => config.queryKey[0] === 'drug-masters',
    );
    const statusConfig = capturedQueryOptions.find(
      (config) => config.queryKey[0] === 'drug-master-status',
    );
    const importLogsConfig = capturedQueryOptions.find(
      (config) => config.queryKey[0] === 'drug-master-import-logs',
    );

    await expect(sitesConfig?.queryFn?.()).rejects.toThrow('拠点一覧を表示できません');
    await expect(
      (
        drugMastersConfig?.queryFn as
          | ((context: { pageParam?: string }) => Promise<unknown>)
          | undefined
      )?.({ pageParam: 'cursor_1' }),
    ).rejects.toThrow('医薬品マスターを表示できません');
    await expect(statusConfig?.queryFn?.()).rejects.toThrow('取込ステータスを表示できません');
    await expect(importLogsConfig?.queryFn?.()).rejects.toThrow('取込履歴を表示できません');
    expect(fetchMock).toHaveBeenCalledWith('/api/pharmacy-sites', {
      headers: buildOrgHeaders('org_1'),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drug-masters?limit=50&site_id=site_1&cursor=cursor_1',
      {
        headers: buildOrgHeaders('org_1'),
      },
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/drug-master-imports/status', {
      headers: buildOrgHeaders('org_1'),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/drug-master-import-logs?limit=10', {
      headers: buildOrgHeaders('org_1'),
    });

    vi.unstubAllGlobals();
  });

  it('keeps API messages and fallbacks from failed drug-detail and formulary read queries', async () => {
    queuePendingFormularyRequest();
    detailDataMock.current = buildGenericDetail();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/generic-recommendations')) {
        return jsonResponse({ error: '推奨後発品は管理者のみ参照できます' }, 403);
      }
      if (url.includes('/ingredient-group')) {
        return new Response('not-json', { status: 500 });
      }
      if (url.includes('/pharmacy-drug-stocks/history')) {
        return new Response('not-json', { status: 500 });
      }
      if (url.includes('/pharmacy-drug-stocks/impact')) {
        return new Response('not-json', { status: 500 });
      }
      if (url.includes('/pharmacy-drug-stocks/usage-mismatch')) {
        return jsonResponse({ message: '処方・採用品不一致を表示できません' }, 403);
      }
      if (url.includes('/pharmacy-drug-stock-requests')) {
        return jsonResponse({ error: '採用品変更申請を表示できません' }, 403);
      }
      if (url.includes('/pharmacy-drug-stock-templates')) {
        return new Response('not-json', { status: 500 });
      }
      if (url.includes('/pharmacy-drug-stocks?') && url.includes('review_due=true')) {
        return jsonResponse({ message: '採用薬レビュー対象を表示できません' }, 403);
      }
      if (url.includes('/pharmacy-drug-stocks?') && url.includes('missing_reorder_point=true')) {
        return jsonResponse({ error: '在庫下限未設定を表示できません' }, 403);
      }
      if (url.includes('/pharmacy-drug-stocks?')) {
        return jsonResponse({ error: '採用品設定を表示できません' }, 403);
      }
      if (url.includes('/drug-masters?')) {
        return jsonResponse({ message: '採用後発薬候補を表示できません' }, 403);
      }
      if (url.includes('/drug-masters/')) {
        return jsonResponse({ message: '医薬品詳細を表示できません' }, 403);
      }
      return jsonResponse({ message: `unexpected fetch: ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<DrugMasterContent variant="formulary" />);
      fireEvent.click(screen.getByText('採用追加'));

      const latestQueryFn = (queryName: string, idIndex?: number) => {
        const options = capturedQueryOptions.filter(
          (candidate) =>
            candidate.queryKey[0] === queryName &&
            (idIndex === undefined || candidate.queryKey[idIndex] === 'drug_generic'),
        );
        const option = options.at(-1);
        expect(option?.queryFn).toBeTruthy();
        return option!.queryFn!;
      };

      await expect(latestQueryFn('drug-master-detail', 2)()).rejects.toThrow(
        '医薬品詳細を表示できません',
      );
      await expect(latestQueryFn('pharmacy-drug-stock')()).rejects.toThrow(
        '採用品設定を表示できません',
      );
      await expect(latestQueryFn('pharmacy-drug-stock-history')()).rejects.toThrow(
        '採用品履歴の取得に失敗しました',
      );
      await expect(
        capturedQueryOptions
          .filter(
            (candidate) =>
              candidate.queryKey[0] === 'pharmacy-drug-stocks' &&
              candidate.queryKey[3] === 'review-due',
          )
          .at(-1)
          ?.queryFn?.(),
      ).rejects.toThrow('採用薬レビュー対象を表示できません');
      await expect(
        capturedQueryOptions
          .filter(
            (candidate) =>
              candidate.queryKey[0] === 'pharmacy-drug-stocks' &&
              candidate.queryKey[3] === 'missing-reorder',
          )
          .at(-1)
          ?.queryFn?.(),
      ).rejects.toThrow('在庫下限未設定を表示できません');
      await expect(latestQueryFn('pharmacy-drug-stocks-impact')()).rejects.toThrow(
        '採用薬影響レビューの取得に失敗しました',
      );
      await expect(latestQueryFn('pharmacy-drug-stock-usage-mismatch')()).rejects.toThrow(
        '処方・採用品不一致を表示できません',
      );
      await expect(latestQueryFn('pharmacy-drug-stock-requests')()).rejects.toThrow(
        '採用品変更申請を表示できません',
      );
      await expect(latestQueryFn('pharmacy-drug-stock-templates')()).rejects.toThrow(
        '採用品テンプレートの取得に失敗しました',
      );
      await expect(latestQueryFn('preferred-generic-candidates', 2)()).rejects.toThrow(
        '採用後発薬候補を表示できません',
      );
      await expect(latestQueryFn('generic-recommendations', 3)()).rejects.toThrow(
        '推奨後発品は管理者のみ参照できます',
      );
      await expect(latestQueryFn('ingredient-group', 3)()).rejects.toThrow(
        '同一成分グループの取得に失敗しました',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves nonstandard success envelopes from drug-detail and formulary read queries', async () => {
    queuePendingFormularyRequest();
    detailDataMock.current = buildGenericDetail();
    const detailBody = { ...buildGenericDetail(), drug_name: '成功詳細薬' };
    const stockConfigBody = { site: { id: 'site_1', name: '本店' }, data: null };
    const stockHistoryBody = { site: { id: 'site_1', name: '本店' }, stock: null, data: [] };
    const impactBody = {
      totals: { stocked_count: 0, action_required_count: 0 },
      selected_queue: { key: 'action_required', rows: [], total_count: 0 },
      master_change_report: { rows: [], total_count: 0 },
      follow_up_summary: { unresolved_count: 0 },
      samples: {},
      recent_changes: [],
    };
    const usageMismatchBody = {
      totals: { unmatched_drug_count: 0 },
      frequent_unstocked: [],
      unused_stocked: [],
      unmatched_prescribed: [],
    };
    const requestsBody = { data: [], summary: { notification_level: 'clear' } };
    const templatesBody = { data: [] };
    const genericCandidatesBody = { data: [] };
    const recommendationsBody = {
      recommendations: [],
      reason: 'generic_name_missing',
    };
    const ingredientGroupBody = {
      generic_name: null,
      summary: null,
      members: [],
      reason: 'generic_name_missing',
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/generic-recommendations')) return jsonResponse(recommendationsBody, 200);
      if (url.includes('/ingredient-group')) return jsonResponse(ingredientGroupBody, 200);
      if (url.includes('/pharmacy-drug-stocks/history')) return jsonResponse(stockHistoryBody, 200);
      if (url.includes('/pharmacy-drug-stocks/impact')) return jsonResponse(impactBody, 200);
      if (url.includes('/pharmacy-drug-stocks/usage-mismatch')) {
        return jsonResponse(usageMismatchBody, 200);
      }
      if (url.includes('/pharmacy-drug-stock-requests')) return jsonResponse(requestsBody, 200);
      if (url.includes('/pharmacy-drug-stock-templates')) return jsonResponse(templatesBody, 200);
      if (url.includes('/pharmacy-drug-stocks?')) return jsonResponse(stockConfigBody, 200);
      if (url.includes('/drug-masters?')) return jsonResponse(genericCandidatesBody, 200);
      if (url.includes('/drug-masters/')) return jsonResponse(detailBody, 200);
      return jsonResponse({ message: `unexpected fetch: ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<DrugMasterContent variant="formulary" />);
      fireEvent.click(screen.getByText('採用追加'));

      const latestQueryFn = (queryName: string, idIndex?: number) => {
        const options = capturedQueryOptions.filter(
          (candidate) =>
            candidate.queryKey[0] === queryName &&
            (idIndex === undefined || candidate.queryKey[idIndex] === 'drug_generic'),
        );
        const option = options.at(-1);
        expect(option?.queryFn).toBeTruthy();
        return option!.queryFn!;
      };

      await expect(latestQueryFn('drug-master-detail', 2)()).resolves.toEqual(detailBody);
      await expect(latestQueryFn('pharmacy-drug-stock')()).resolves.toEqual(stockConfigBody);
      await expect(latestQueryFn('pharmacy-drug-stock-history')()).resolves.toEqual(
        stockHistoryBody,
      );
      await expect(latestQueryFn('pharmacy-drug-stocks-impact')()).resolves.toEqual(impactBody);
      await expect(latestQueryFn('pharmacy-drug-stock-usage-mismatch')()).resolves.toEqual(
        usageMismatchBody,
      );
      await expect(latestQueryFn('pharmacy-drug-stock-requests')()).resolves.toEqual(requestsBody);
      await expect(latestQueryFn('pharmacy-drug-stock-templates')()).resolves.toEqual(
        templatesBody,
      );
      await expect(latestQueryFn('preferred-generic-candidates', 2)()).resolves.toEqual(
        genericCandidatesBody,
      );
      await expect(latestQueryFn('generic-recommendations', 3)()).resolves.toEqual(
        recommendationsBody,
      );
      await expect(latestQueryFn('ingredient-group', 3)()).resolves.toEqual(ingredientGroupBody);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses an announced skeleton while the drug detail sheet loads the selected drug', () => {
    queuePendingFormularyRequest();
    queryLoadingKeys.add('drug-master-detail');

    render(<DrugMasterContent variant="formulary" />);
    fireEvent.click(screen.getByText('採用追加'));

    expect(screen.getByRole('status', { name: '医薬品詳細を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('医薬品詳細を読み込み中です…', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('医薬品詳細の取得に失敗しました')).toBeNull();
  });

  it('shows a sanitized drug detail error instead of the raw backend error detail', () => {
    queuePendingFormularyRequest();
    queryErrorKeys.add('drug-master-detail');

    render(<DrugMasterContent variant="formulary" />);
    fireEvent.click(screen.getByText('採用追加'));

    expect(screen.getByText('医薬品詳細を取得できませんでした')).toBeTruthy();
    expectUnsafeBackendDetailNotRendered();
  });

  it('uses an announced skeleton while the stock config panel loads', () => {
    queuePendingFormularyRequest();
    detailDataMock.current = buildGenericDetail();
    queryLoadingKeys.add('pharmacy-drug-stock');

    render(<DrugMasterContent variant="formulary" />);
    fireEvent.click(screen.getByText('採用追加'));

    expect(screen.getByRole('status', { name: '採用品設定を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('採用品設定を読み込み中です…', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('採用品設定を読み込めませんでした')).toBeNull();
    expect(screen.queryByText('未登録')).toBeNull();
  });

  it('uses an announced skeleton while the stock history panel loads', () => {
    queuePendingFormularyRequest();
    detailDataMock.current = buildGenericDetail();
    queryLoadingKeys.add('pharmacy-drug-stock-history');

    render(<DrugMasterContent variant="formulary" />);
    fireEvent.click(screen.getByText('採用追加'));

    expect(screen.getByRole('status', { name: '採用品履歴を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('採用品履歴を読み込み中です…', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('採用品変更履歴を読み込めませんでした')).toBeNull();
    expect(screen.queryByText('この薬剤の採用品変更履歴はまだありません。')).toBeNull();
  });

  it('uses an announced skeleton while import history loads', () => {
    queryLoadingKeys.add('drug-master-import-logs');

    render(<DrugMasterContent />);

    expect(screen.getByRole('status', { name: '取込履歴を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('履歴を読み込み中です…', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('取込履歴を読み込めませんでした')).toBeNull();
    expect(screen.queryByText('まだ取込履歴はありません。')).toBeNull();
  });

  it('shows a retryable error instead of an empty import history when the audit log fetch fails', () => {
    queryErrorKeys.add('drug-master-import-logs');
    render(<DrugMasterContent />);

    expect(screen.getByText('取込履歴を読み込めませんでした')).toBeTruthy();
    expect(screen.queryByText('まだ取込履歴はありません。')).toBeNull();
    // The summary count must not show a false "表示: 0件" next to the fetch error.
    expect(screen.getByText('表示: 取得失敗')).toBeTruthy();
    expect(screen.queryByText('表示: 0件')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: '再読み込み' })[0]);
    expect(refetchSpies.get('drug-master-import-logs')).toHaveBeenCalled();
  });

  it('keeps the master-status section visible with an error instead of hiding it on fetch failure', () => {
    queryErrorKeys.add('drug-master-status');
    render(<DrugMasterContent />);

    expect(screen.getByText('マスター更新ステータスを読み込めませんでした')).toBeTruthy();
    // The success summary sources must not appear when the status fetch failed.
    expect(screen.queryByText('SSK基本マスター')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: '再読み込み' })[0]);
    expect(refetchSpies.get('drug-master-status')).toHaveBeenCalled();
  });

  it('warns that the site picker is unavailable rather than empty when the site lookup fails', () => {
    queryErrorKeys.add('pharmacy-sites');
    render(<DrugMasterContent />);

    expect(screen.getByText('拠点一覧を読み込めませんでした')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: '再読み込み' })[0]);
    expect(refetchSpies.get('pharmacy-sites')).toHaveBeenCalled();
  });

  it('shows retryable errors instead of false-empty formulary operation panels when subqueries fail', () => {
    queryErrorKeys.add(reviewDueQueryKey);
    queryErrorKeys.add(missingReorderQueryKey);
    queryErrorKeys.add('pharmacy-drug-stocks-impact');
    queryErrorKeys.add('pharmacy-drug-stock-usage-mismatch');
    queryErrorKeys.add('pharmacy-drug-stock-requests');

    render(<DrugMasterContent variant="formulary" />);

    expect(screen.getByText('レビュー期限超過を読み込めませんでした')).toBeTruthy();
    expect(screen.getByText('在庫下限未設定を読み込めませんでした')).toBeTruthy();
    expect(screen.getByText('採用品変更申請を読み込めませんでした')).toBeTruthy();
    expect(screen.getByText('処方・採用品不一致を読み込めませんでした')).toBeTruthy();
    expect(screen.getByText('採用薬影響レビューを読み込めませんでした')).toBeTruthy();
    expect(screen.queryByText('未承認の変更申請はありません。')).toBeNull();
    expect(screen.queryByText('頻出している未採用品はありません。')).toBeNull();
    expect(screen.queryByText('直近QR処方で未使用の採用品はありません。')).toBeNull();
    expect(screen.queryByText('対象の採用薬はありません。')).toBeNull();
    expect(screen.queryByText('未承認 0件')).toBeNull();

    screen.getAllByRole('button', { name: '再読み込み' }).forEach((button) => {
      fireEvent.click(button);
    });
    expect(refetchSpies.get(reviewDueQueryKey)).toHaveBeenCalled();
    expect(refetchSpies.get(missingReorderQueryKey)).toHaveBeenCalled();
    expect(refetchSpies.get('pharmacy-drug-stocks-impact')).toHaveBeenCalled();
    expect(refetchSpies.get('pharmacy-drug-stock-usage-mismatch')).toHaveBeenCalled();
    expect(refetchSpies.get('pharmacy-drug-stock-requests')).toHaveBeenCalled();
  });

  it('keeps review completion disabled when the review-due query fails with stale data', () => {
    queryErrorKeys.add(reviewDueQueryKey);
    staleQueryDataByKey.set(reviewDueQueryKey, { data: [buildReviewDueStock()] });

    render(<DrugMasterContent variant="formulary" />);

    expect(screen.getByText('レビュー期限超過を読み込めませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'レビュー済み' })).toHaveProperty('disabled', true);
  });

  it('shows retryable errors instead of silently dropping detail generic panels when subqueries fail', () => {
    queuePendingFormularyRequest();
    detailDataMock.current = buildGenericDetail();
    queryErrorKeys.add('generic-recommendations');
    queryErrorKeys.add('ingredient-group');

    render(<DrugMasterContent variant="formulary" />);
    fireEvent.click(screen.getByText('採用追加'));

    expect(screen.getByText('推奨後発品を読み込めませんでした')).toBeTruthy();
    expect(screen.getByText('同一成分グループを読み込めませんでした')).toBeTruthy();
    expectUnsafeBackendDetailNotRendered();

    screen.getAllByRole('button', { name: '再読み込み' }).forEach((button) => {
      fireEvent.click(button);
    });
    expect(refetchSpies.get('generic-recommendations')).toHaveBeenCalled();
    expect(refetchSpies.get('ingredient-group')).toHaveBeenCalled();
  });

  it('shows stock-config fetch errors instead of unregistered adoption actions', () => {
    queuePendingFormularyRequest();
    detailDataMock.current = buildGenericDetail();
    queryErrorKeys.add('pharmacy-drug-stock');

    render(<DrugMasterContent variant="formulary" />);
    fireEvent.click(screen.getByText('採用追加'));

    expect(screen.getByText('採用品設定を読み込めませんでした')).toBeTruthy();
    expectUnsafeBackendDetailNotRendered();
    expect(screen.queryByText('未登録')).toBeNull();
    expect(screen.queryByText('この薬を採用品として登録できます。')).toBeNull();
    expect(screen.queryByRole('button', { name: '採用品に登録' })).toBeNull();
    expect(screen.queryByRole('button', { name: '変更申請' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: '再読み込み' })[0]);
    expect(refetchSpies.get('pharmacy-drug-stock')).toHaveBeenCalled();
  });

  it('shows retryable errors instead of a false-empty adoption-change history when the fetch fails', () => {
    queuePendingFormularyRequest();
    detailDataMock.current = buildGenericDetail();
    queryErrorKeys.add('pharmacy-drug-stock-history');

    render(<DrugMasterContent variant="formulary" />);
    fireEvent.click(screen.getByText('採用追加'));

    expect(screen.getByText('採用品変更履歴を読み込めませんでした')).toBeTruthy();
    expectUnsafeBackendDetailNotRendered();
    expect(screen.queryByText('この薬剤の採用品変更履歴はまだありません。')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: '再読み込み' })[0]);
    expect(refetchSpies.get('pharmacy-drug-stock-history')).toHaveBeenCalled();
  });

  it('shows retryable errors instead of a false-empty formulary template list when the fetch fails', () => {
    queryErrorKeys.add('pharmacy-drug-stock-templates');

    render(<DrugMasterContent variant="formulary" />);

    expect(screen.getByText('採用品テンプレートを読み込めませんでした')).toBeTruthy();
    expect(screen.getByText('取得失敗')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: '再読み込み' })[0]);
    expect(refetchSpies.get('pharmacy-drug-stock-templates')).toHaveBeenCalled();
  });

  it('shows retryable errors instead of a false-empty preferred-generic select when the fetch fails', () => {
    queuePendingFormularyRequest();
    detailDataMock.current = buildGenericDetail();
    queryErrorKeys.add('preferred-generic-candidates');

    render(<DrugMasterContent variant="formulary" />);
    fireEvent.click(screen.getByText('採用追加'));

    expect(screen.getByText('採用後発薬候補を読み込めませんでした')).toBeTruthy();
    expectUnsafeBackendDetailNotRendered();

    fireEvent.click(screen.getAllByRole('button', { name: '再読み込み' })[0]);
    expect(refetchSpies.get('preferred-generic-candidates')).toHaveBeenCalled();
  });

  it('keeps the generic recommendation and ingredient-group success panels visible', () => {
    queuePendingFormularyRequest();
    detailDataMock.current = buildGenericDetail();
    genericRecommendationsDataMock.current = [
      {
        id: 'gen_1',
        yj_code: '222222222222',
        drug_name: 'ロキソプロフェンGE錠',
        generic_name: 'ロキソプロフェン',
        drug_price: 9.8,
        unit: '錠',
        manufacturer: null,
        is_generic: true,
        transitional_expiry_date: null,
        price_delta: -7.3,
        price_delta_percent: -42.7,
        site_stock: {
          drug_master_id: 'gen_1',
          is_stocked: false,
          preferred_generic_id: null,
          reorder_point: null,
        },
      },
    ];
    ingredientGroupDataMock.current = {
      site: { id: 'site_1', name: '本店' },
      target: {
        id: 'drug_generic',
        yj_code: '111111111111',
        drug_name: '先発薬A',
        generic_name: 'ロキソプロフェン',
        drug_price: 17.1,
        unit: '錠',
        is_generic: false,
      },
      generic_name: 'ロキソプロフェン',
      summary: {
        member_count: 2,
        brand_count: 1,
        generic_count: 1,
        stocked_count: 1,
        unstocked_count: 1,
        lowest_price: 9.8,
        highest_price: 17.1,
      },
      members: [
        {
          id: 'gen_1',
          yj_code: '222222222222',
          drug_name: 'ロキソプロフェンGE錠',
          generic_name: 'ロキソプロフェン',
          drug_price: 9.8,
          unit: '錠',
          manufacturer: null,
          is_generic: true,
          transitional_expiry_date: null,
          site_stock: {
            drug_master_id: 'gen_1',
            is_stocked: false,
            preferred_generic_id: null,
            reorder_point: null,
            follow_up_status: null,
          },
        },
      ],
    };

    render(<DrugMasterContent variant="formulary" />);
    fireEvent.click(screen.getByText('採用追加'));

    expect(screen.getByText('薬価順の推奨候補')).toBeTruthy();
    expect(screen.getAllByText('ロキソプロフェンGE錠').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('同一成分グループ')).toBeTruthy();
    expect(screen.queryByText('推奨後発品を読み込めませんでした')).toBeNull();
    expect(screen.queryByText('同一成分グループを読み込めませんでした')).toBeNull();
  });
});
