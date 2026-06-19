// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { UsersContent } from './users-content';

setupDomTestEnv();

const mutationMutateMock = vi.hoisted(() => vi.fn());

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
        data: { data: [user] },
        isLoading: false,
      };
    }

    if (key === 'pharmacy-sites') {
      return {
        data: { data: [{ id: 'site_1', name: '本店' }] },
        isLoading: false,
      };
    }

    return { data: { data: [] }, isLoading: false };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
  }: {
    columns: Array<{ id?: string; cell?: (args: { row: { original: unknown } }) => ReactNode }>;
    data: unknown[];
  }) => (
    <div>
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
  });

  it('associates user filters and row actions with accessible names', () => {
    render(<UsersContent />);

    expect(screen.getByLabelText('検索')).toBeTruthy();
    expect(screen.getByLabelText('ロール', { selector: '#user-filter-role' })).toBeTruthy();
    expect(screen.getByLabelText('所属店舗', { selector: '#user-filter-site' })).toBeTruthy();
    expect(screen.getByLabelText('状態')).toBeTruthy();
    expect(screen.getByLabelText('資格')).toBeTruthy();
    expect(screen.getByRole('button', { name: '山田 太郎の詳細を開く' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '山田 太郎を停止' })).toBeTruthy();
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
});
