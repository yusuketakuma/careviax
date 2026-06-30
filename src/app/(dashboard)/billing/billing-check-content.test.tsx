// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import type { BillingCheckResponse } from '@/types/billing-check';

setupDomTestEnv();

const useQueryMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

import { BillingCheckContent, fetchBillingCheck, formatAgeLabel } from './billing-check-content';

function buildFixture(): BillingCheckResponse {
  return {
    generated_at: new Date(2026, 5, 12, 9, 42).toISOString(),
    month: 'current',
    month_label: '2026年6月分',
    month_short_label: '6月分',
    passed_count: 128,
    review_count: 3,
    today_pending_count: 3,
    review_rows: [
      {
        id: 'candidate_1',
        patient_label: '新規 鈴木 様',
        patient_href: '/patients/patient_suzuki',
        billing_name: '在宅移行初期管理料',
        confirm_text: '受入確定が前提 — 本日17:00の判断待ち',
        evidence_label: '告示第69号',
        evidence_href: '/admin/billing-rules',
        action_label: '→ ダッシュボードへ',
        action_href: '/dashboard',
      },
      {
        id: 'candidate_2',
        patient_label: '吉田 進 様(入院中)',
        patient_href: '/patients/patient_yoshida',
        billing_name: '退院時共同指導料',
        confirm_text: '退院日と病院側カンファ日程の確認',
        evidence_label: '算定要件',
        evidence_href: '/admin/billing-rules',
        action_label: '病院へ確認',
        action_href: '/admin/institutions',
      },
      {
        id: 'candidate_3',
        patient_label: '田中 一郎 様',
        patient_href: '/patients/patient_tanaka',
        billing_name: '麻薬管理指導加算',
        confirm_text: '本日14:00訪問の実施記録で自動確定',
        evidence_label: '算定要件',
        evidence_href: '/admin/billing-rules',
        action_label: '→ 訪問へ',
        action_href: '/patients/patient_tanaka/safety-check',
      },
    ],
    records: {
      rule_revision_label: '令和8年改定',
      rejection_count: 0,
      summary_template_kind_count: 12,
    },
    rail: {
      next_action: {
        label: '麻薬監査を開始 — 12:00期限',
        description: '14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。',
        href: '/audit',
      },
      blocked_reasons: [
        {
          id: 'exception_1',
          label: 'ご家族の同意待ち(新規契約)',
          severity: 'critical',
          category: '患者',
          age_minutes: 25 * 60,
          action_label: '再連絡する →',
          action_href: '/communications/requests',
        },
        {
          id: 'exception_2',
          label: '送付先の確認(やまもと内科)',
          severity: 'warning',
          category: '事務',
          age_minutes: 30,
          action_label: '状況を見る →',
          action_href: '/admin/contact-profiles',
        },
      ],
    },
  };
}

describe('BillingCheckContent', () => {
  beforeEach(() => {
    useUIStore.setState({ workspaceRailOpen: true });
    refetchMock.mockClear();
    useQueryMock.mockReturnValue({
      data: buildFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.mocked(buildOrgHeaders).mockImplementation((orgId, extra) => ({
      'x-org-id': orgId,
      ...extra,
    }));
    window.history.replaceState({}, '', '/');
  });

  it('fetches the billing check contract with helper org headers', async () => {
    const fixture = buildFixture();
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: fixture }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBillingCheck('org_1', 'current');

    expect(result).toBe(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/billing-evidence/check?month=current');
    expect(init.headers).toBe(sentinelHeaders);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(1, 'org_1');
  });

  it('renders the header row with month summary and the month toggle', () => {
    render(<BillingCheckContent />);

    expect(screen.getByRole('heading', { name: '算定チェック' })).toBeTruthy();
    expect(screen.getByText('2026年6月分 — 合格128 / 疑義3')).toBeTruthy();

    const toggle = screen.getByRole('group', { name: '対象月の切替' });
    expect(within(toggle).getByRole('button', { name: '今月' })).toBeTruthy();
    fireEvent.click(within(toggle).getByRole('button', { name: '先月' }));
    expect(useQueryMock.mock.calls.at(-1)?.[0].queryKey).toEqual([
      'billing-check',
      'org_1',
      'previous',
    ]);
  });

  it('renders the 3 KPI cards (passed / review / today)', () => {
    render(<BillingCheckContent />);

    const passed = screen.getByTestId('billing-check-kpi-passed');
    expect(within(passed).getByText('6月分 自動チェック')).toBeTruthy();
    expect(within(passed).getByText('128')).toBeTruthy();
    expect(within(passed).getByText('件 合格')).toBeTruthy();

    const review = screen.getByTestId('billing-check-kpi-review');
    expect(within(review).getByText('疑義(人の確認待ち)')).toBeTruthy();

    const today = screen.getByTestId('billing-check-kpi-today');
    expect(within(today).getByText('本日訪問の算定候補')).toBeTruthy();
    expect(within(today).getByText('件(訪問完了後に確定)')).toBeTruthy();
  });

  it('renders 疑義 rows with evidence pills and return-path actions', () => {
    render(<BillingCheckContent />);

    const section = screen.getByTestId('billing-check-review-table');
    expect(within(section).getByText('疑義 — 根拠とセットでしか出さない')).toBeTruthy();
    expect(
      within(section).getByText('自動チェックを通らなかったものだけが人に届きます'),
    ).toBeTruthy();

    const table = within(section).getByRole('table', { name: '算定チェック疑義一覧' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(section).queryByRole('button', { name: /列/ })).toBeNull();
    expect(within(section).queryByRole('textbox')).toBeNull();
    expect(within(section).queryByRole('button', { name: 'CSV出力' })).toBeNull();
    expect(within(section).queryByRole('button', { name: '印刷' })).toBeNull();

    expect(within(table).getByText('新規 鈴木 様')).toBeTruthy();
    expect(within(table).getByText('在宅移行初期管理料')).toBeTruthy();
    expect(within(table).getByText('受入確定が前提 — 本日17:00の判断待ち')).toBeTruthy();
    expect(within(table).getByRole('link', { name: '告示第69号 →' })).toBeTruthy();
    expect(within(table).getByRole('link', { name: '→ ダッシュボードへ' })).toBeTruthy();

    expect(within(table).getByText('吉田 進 様(入院中)')).toBeTruthy();
    expect(within(table).getByRole('link', { name: '病院へ確認' })).toBeTruthy();

    // 危険語(麻薬)を隠さない
    expect(within(table).getByText('麻薬管理指導加算')).toBeTruthy();
    expect(within(table).getByRole('link', { name: '→ 訪問へ' }).getAttribute('href')).toBe(
      '/patients/patient_tanaka/safety-check',
    );

    expect(
      screen.getByText(
        'レセプト摘要欄の文言は算定項目から自動生成されます。手で書くのは「確認すること」列の事実確認だけです。',
      ),
    ).toBeTruthy();
  });

  it('renders the primary strip and keeps the existing action rail', () => {
    render(<BillingCheckContent />);

    const primaryStrip = screen.getByTestId('billing-primary-strip');
    expect(
      within(primaryStrip).getByRole('link', { name: '麻薬監査を開始 — 12:00期限' }),
    ).toBeTruthy();
    expect(within(primaryStrip).getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(within(primaryStrip).getByRole('link', { name: '再連絡する →' })).toBeTruthy();
    expect(within(primaryStrip).getByText('算定ルール版')).toBeTruthy();
    expect(within(primaryStrip).getByText('令和8年改定')).toBeTruthy();
    expect(
      within(primaryStrip).getByText(
        '14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。',
      ),
    ).toBeTruthy();
    expect(within(primaryStrip).getByText('患者')).toBeTruthy();
    expect(within(primaryStrip).getByText('1日')).toBeTruthy();
    expect(within(primaryStrip).queryByText('送付先の確認(やまもと内科)')).toBeNull();
    expect(within(primaryStrip).getByText('返戻履歴')).toBeTruthy();
    expect(within(primaryStrip).getByText('直近0件')).toBeTruthy();
    expect(within(primaryStrip).getByText('摘要欄テンプレ')).toBeTruthy();
    expect(within(primaryStrip).getByText('12種')).toBeTruthy();

    const nextAction = screen.getByTestId('next-action-panel');
    expect(
      within(nextAction).getByRole('link', { name: '麻薬監査を開始 — 12:00期限' }),
    ).toBeTruthy();

    const blocked = screen.getByTestId('blocked-reasons-panel');
    expect(within(blocked).getByText('送付先の確認(やまもと内科)')).toBeTruthy();

    const evidence = screen.getByTestId('evidence-panel');
    expect(within(evidence).getByText('薬局間協力')).toBeTruthy();
  });

  it('shows the green empty bar when there are no 疑義 rows', () => {
    const fixture = buildFixture();
    fixture.review_rows = [];
    fixture.review_count = 0;
    useQueryMock.mockReturnValue({
      data: fixture,
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });

    render(<BillingCheckContent />);

    expect(screen.getByText('疑義はありません — 自動チェックをすべて通過しています')).toBeTruthy();
  });

  it('shows the error state with retry when the fetch fails', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: refetchMock,
    });

    render(<BillingCheckContent />);

    expect(screen.getByText('算定チェックを表示できません')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMock).toHaveBeenCalled();
  });
});

describe('formatAgeLabel', () => {
  it('formats minutes, hours, and days', () => {
    expect(formatAgeLabel(30)).toBe('30分');
    expect(formatAgeLabel(90)).toBe('1時間');
    expect(formatAgeLabel(25 * 60)).toBe('1日');
  });
});
