// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { UsersContent } from './users-content';

setupDomTestEnv();

const mutationMutateMock = vi.hoisted(() => vi.fn());
const queryErrorKeysMock = vi.hoisted(() => new Set<string>());
const queryRefetchMock = vi.hoisted(() => vi.fn());
const adminUsersResponseMock = vi.hoisted(() => ({
  current: null as null | {
    data: unknown[];
    total_count?: number;
    visible_count?: number;
    hidden_count?: number;
    truncated?: boolean;
    count_basis?: string;
    filters_applied?: Record<string, unknown>;
    limit?: number;
  },
}));

const user = {
  id: 'user_1',
  cognito_linked: true,
  name: '山田 太郎',
  name_kana: 'ヤマダ タロウ',
  email: 'taro@example.com',
  phone: '090-0000-0000',
  role: 'pharmacist',
  site_id: 'site_1',
  site_name: '本店',
  is_active: true,
  account_status: 'active',
  invited_at: '2026-06-01T00:00:00.000Z',
  last_invited_at: '2026-06-02T00:00:00.000Z',
  activated_at: '2026-06-03T00:00:00.000Z',
  deactivated_at: null,
  deactivation_reason: null,
  last_active_at: '2026-06-19T00:00:00.000Z',
  max_daily_visits: 8,
  max_weekly_visits: 30,
  max_travel_minutes: 90,
  can_accept_emergency: true,
  visit_specialties: ['緩和ケア'],
  coverage_area: ['港区'],
  can_dispense: true,
  can_audit_dispense: true,
  can_set: false,
  can_audit_set: false,
  credential_types: ['在宅認定'],
  monthly_visit_count: 12,
};

const defaultUser = { ...user };

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: mutationMutateMock,
    isPending: false,
  }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0];

    if (key === 'admin-users') {
      return {
        data: queryErrorKeysMock.has('admin-users')
          ? undefined
          : (adminUsersResponseMock.current ?? {
              data: [user],
              total_count: 1,
              visible_count: 1,
              hidden_count: 0,
              truncated: false,
              count_basis: 'unique_users',
            }),
        isLoading: false,
        isError: queryErrorKeysMock.has('admin-users'),
        refetch: queryRefetchMock,
      };
    }

    if (key === 'pharmacy-sites') {
      return {
        data: { data: [{ id: 'site_1', name: '本店' }] },
        isLoading: false,
        isError: false,
        refetch: queryRefetchMock,
      };
    }

    return { data: { data: [] }, isLoading: false, isError: false, refetch: queryRefetchMock };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
    errorMessage,
    onRetry,
  }: {
    columns: Array<{ id?: string; cell?: (args: { row: { original: unknown } }) => ReactNode }>;
    data: unknown[];
    errorMessage?: string;
    onRetry?: () => void;
  }) => (
    <div>
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
      {data.map((row, rowIndex) => (
        <div key={rowIndex}>
          {columns.map((column, columnIndex) =>
            column.cell ? (
              <div key={column.id ?? columnIndex}>{column.cell({ row: { original: row } })}</div>
            ) : null,
          )}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('UsersContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryErrorKeysMock.clear();
    adminUsersResponseMock.current = null;
    Object.assign(user, defaultUser);
  });

  it('associates user filters and row actions with accessible names', () => {
    render(<UsersContent />);

    expect(screen.getByLabelText('検索')).toBeTruthy();
    expect(screen.getByLabelText('ロール', { selector: '#user-filter-role' })).toBeTruthy();
    expect(screen.getByLabelText('所属店舗', { selector: '#user-filter-site' })).toBeTruthy();
    expect(screen.getByLabelText('状態')).toBeTruthy();
    expect(screen.getByLabelText('資格')).toBeTruthy();
    // 既定フィルタは生 enum('all')でなく日本語ラベル('すべて')を初期表示する(Radix SSR ラベル解決対策)
    const roleTrigger = screen.getByLabelText('ロール', { selector: '#user-filter-role' });
    expect(roleTrigger.textContent).toContain('すべて');
    expect(roleTrigger.textContent).not.toContain('all');
    expect(screen.getByRole('button', { name: '山田 太郎の詳細を開く' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '山田 太郎を停止' })).toBeTruthy();
  });

  it('renders account status via state-color tokens with red limited to blocked', () => {
    // active=done(緑), suspended=blocked(赤), invited=waiting, retired=readonly。
    // 赤(blocked)は停止/連携失敗のみ=「赤=ブロック限定」を満たす。
    Object.assign(user, { account_status: 'active' });
    const active = render(<UsersContent />);
    expect(active.container.querySelector('[data-role="done"]')).toBeTruthy();
    active.unmount();

    Object.assign(user, { account_status: 'suspended' });
    const suspended = render(<UsersContent />);
    expect(suspended.container.querySelector('[data-role="blocked"]')).toBeTruthy();
    suspended.unmount();

    Object.assign(user, { account_status: 'invited' });
    const invited = render(<UsersContent />);
    expect(invited.container.querySelector('[data-role="waiting"]')).toBeTruthy();
    invited.unmount();

    Object.assign(user, { account_status: 'retired' });
    const retired = render(<UsersContent />);
    expect(retired.container.querySelector('[data-role="readonly"]')).toBeTruthy();
    // retired は赤(blocked)に落ちない。
    expect(retired.container.querySelector('[data-role="blocked"]')).toBeNull();
  });

  it('keeps the user list workflow before supplemental filters', () => {
    render(<UsersContent />);

    const listTitle = screen.getByText('ユーザー一覧');
    const inviteButton = screen.getByRole('button', { name: 'ユーザーを招待' });
    const searchInput = screen.getByLabelText('検索');
    const detailButton = screen.getByRole('button', { name: '山田 太郎の詳細を開く' });
    const detailFilter = screen.getByText('詳細フィルタ');

    expect(
      Boolean(listTitle.compareDocumentPosition(inviteButton) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(
      Boolean(listTitle.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(
      Boolean(searchInput.compareDocumentPosition(detailButton) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(
      Boolean(
        detailButton.compareDocumentPosition(detailFilter) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it('associates invite form fields with visible labels', () => {
    render(<UsersContent />);

    fireEvent.click(screen.getByRole('button', { name: 'ユーザーを招待' }));

    expect(screen.getByLabelText('氏名')).toBeTruthy();
    expect(screen.getByLabelText('フリガナ')).toBeTruthy();
    expect(screen.getByLabelText('メールアドレス')).toBeTruthy();
    expect(screen.getByLabelText('電話番号')).toBeTruthy();
    expect(screen.getByLabelText('ロール', { selector: '#invite-user-role' })).toBeTruthy();
    expect(screen.getByLabelText('所属店舗', { selector: '#invite-user-site' })).toBeTruthy();
  });

  it('shows the role label, not the raw enum, in the invite and detail role selects', () => {
    // bare <SelectValue /> は非空 enum default(EMPTY_INVITE/ユーザー role='pharmacist')の生値を漏らす。
    // 明示 children で常にラベル(薬剤師)を表示することを固定する(SSR enum 漏れ封止)。
    // dialog の重なりを避けるため invite/detail は別 render で検証する。
    const invite = render(<UsersContent />);
    fireEvent.click(invite.getByRole('button', { name: 'ユーザーを招待' }));
    const inviteRole = invite.getByLabelText('ロール', { selector: '#invite-user-role' });
    expect(inviteRole.textContent).toContain('薬剤師');
    expect(inviteRole.textContent).not.toContain('pharmacist');
    invite.unmount();

    const detail = render(<UsersContent />);
    fireEvent.click(detail.getByRole('button', { name: '山田 太郎の詳細を開く' }));
    const detailRole = detail.getByLabelText('ロール', { selector: '#detail-user-role' });
    expect(detailRole.textContent).toContain('薬剤師');
    expect(detailRole.textContent).not.toContain('pharmacist');
    detail.unmount();
  });

  it('associates detail and action dialog fields with visible labels', () => {
    render(<UsersContent />);

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎の詳細を開く' }));

    expect(screen.getByLabelText('氏名')).toBeTruthy();
    expect(screen.getByLabelText('フリガナ')).toBeTruthy();
    expect(screen.getByLabelText('メールアドレス')).toBeTruthy();
    expect(screen.getByLabelText('電話番号')).toBeTruthy();
    expect(screen.getByLabelText('ロール', { selector: '#detail-user-role' })).toBeTruthy();
    expect(screen.getByLabelText('所属店舗', { selector: '#detail-user-site' })).toBeTruthy();
    expect(screen.getByLabelText('調剤入力')).toBeTruthy();
    expect(screen.getByLabelText('調剤監査')).toBeTruthy();
    expect(screen.getByLabelText('セット作業')).toBeTruthy();
    expect(screen.getByLabelText('セット監査')).toBeTruthy();
    expect(screen.getByLabelText('日次上限')).toBeTruthy();
    expect(screen.getByLabelText('週次上限')).toBeTruthy();
    expect(screen.getByLabelText('移動上限(分)')).toBeTruthy();
    expect(screen.getByLabelText('緊急対応可')).toBeTruthy();
    expect(screen.getByLabelText('専門分野')).toBeTruthy();
    expect(screen.getByLabelText('対応エリア')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎を退職処理' }));

    expect(screen.getByLabelText('理由')).toBeTruthy();
  });

  it('constrains visit limit inputs and blocks invalid detail saves inline', () => {
    render(<UsersContent />);

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎の詳細を開く' }));

    const dailyLimit = screen.getByLabelText('日次上限') as HTMLInputElement;
    const weeklyLimit = screen.getByLabelText('週次上限') as HTMLInputElement;
    const travelLimit = screen.getByLabelText('移動上限(分)') as HTMLInputElement;

    expect(dailyLimit.min).toBe('1');
    expect(dailyLimit.max).toBe('20');
    expect(dailyLimit.step).toBe('1');
    expect(dailyLimit.inputMode).toBe('numeric');
    expect(weeklyLimit.min).toBe('1');
    expect(weeklyLimit.max).toBe('100');
    expect(travelLimit.min).toBe('0');
    expect(travelLimit.max).toBe('480');

    fireEvent.change(dailyLimit, { target: { value: '21' } });

    expect(screen.getAllByText('日次上限は1〜20件の整数で入力してください。')).toHaveLength(2);
    expect(dailyLimit.getAttribute('aria-invalid')).toBe('true');
    expect(dailyLimit.getAttribute('aria-describedby')).toContain('detail-max-daily-visits-error');

    const saveButton = screen.getByRole('button', { name: '変更を保存' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect(saveButton.getAttribute('aria-describedby')).toBe('detail-user-save-blocker');

    fireEvent.click(saveButton);
    expect(mutationMutateMock).not.toHaveBeenCalled();
  });

  it('describes why visit constraint controls are disabled for non-operational roles', () => {
    Object.assign(user, {
      role: 'external_viewer',
      max_daily_visits: 8,
      max_weekly_visits: 30,
      max_travel_minutes: 90,
    });

    render(<UsersContent />);

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎の詳細を開く' }));

    const dailyLimit = screen.getByLabelText('日次上限') as HTMLInputElement;
    const specialties = screen.getByLabelText('専門分野') as HTMLTextAreaElement;

    expect(dailyLimit.disabled).toBe(true);
    expect(dailyLimit.getAttribute('aria-describedby')).toContain(
      'detail-visit-constraints-role-help',
    );
    expect(specialties.disabled).toBe(true);
    expect(specialties.getAttribute('aria-describedby')).toBe('detail-visit-constraints-role-help');
    expect(screen.getByText('非訪問ロールでは保存時にクリアされます。')).toBeTruthy();
  });

  it('passes user query failures to DataTable without showing false-zero summaries', () => {
    queryErrorKeysMock.add('admin-users');

    render(<UsersContent />);

    expect(screen.getByRole('alert').textContent).toContain('ユーザー一覧を取得できませんでした');
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    expect(queryRefetchMock).toHaveBeenCalled();
  });

  it('shows hidden user counts when the staff master list is truncated', () => {
    adminUsersResponseMock.current = {
      data: [user],
      total_count: 3,
      visible_count: 1,
      hidden_count: 2,
      truncated: true,
      count_basis: 'unique_users',
      filters_applied: {
        site_id: null,
        include_collaborators: true,
      },
      limit: 500,
    };

    render(<UsersContent />);

    expect(screen.getByText('先頭1件を表示 / 他2件')).toBeTruthy();
    expect(
      screen.getByText((_content, element) => element?.textContent === '総ユーザー数: 3'),
    ).toBeTruthy();
    expect(
      screen.getByText((_content, element) => element?.textContent === '表示中 稼働中: 1'),
    ).toBeTruthy();
  });
});
