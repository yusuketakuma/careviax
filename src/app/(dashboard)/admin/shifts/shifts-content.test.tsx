// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ShiftsContent } from './shifts-content';

setupDomTestEnv();

const mutationMutateMock = vi.hoisted(() => vi.fn());

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

    if (key === 'pharmacy-sites') {
      return {
        data: {
          data: [{ id: 'site_1', name: '本店', address: '東京都' }],
        },
        isLoading: false,
      };
    }

    if (key === 'pharmacists') {
      return {
        data: {
          data: [
            {
              id: 'user_1',
              name: '山田 太郎',
              name_kana: 'ヤマダ タロウ',
              email: 'taro@example.test',
              phone: null,
              role: 'pharmacist',
              site_id: 'site_1',
              site_name: '本店',
              is_active: true,
              account_status: 'active',
              invited_at: null,
              last_invited_at: null,
              activated_at: '2026-06-01T00:00:00.000Z',
              deactivated_at: null,
              deactivation_reason: null,
              max_daily_visits: 6,
              max_weekly_visits: 25,
              max_travel_minutes: 90,
              can_accept_emergency: true,
              visit_specialties: null,
              coverage_area: null,
            },
          ],
        },
        isLoading: false,
      };
    }

    if (key === 'pharmacist-shifts') {
      return { data: { data: [] }, isLoading: false };
    }

    if (key === 'business-holidays') {
      return {
        data: {
          data: [
            {
              id: 'holiday_1',
              site_id: 'site_1',
              date: '2026-06-20',
              name: '棚卸休業',
              holiday_type: 'site_closure',
              is_closed: true,
              site: { id: 'site_1', name: '本店' },
            },
          ],
        },
        isLoading: false,
      };
    }

    if (key === 'pharmacist-shift-templates') {
      return {
        data: {
          data: [
            {
              id: 'template_1',
              user_id: 'user_1',
              site_id: 'site_1',
              weekday: 1,
              available: false,
              available_from: null,
              available_to: null,
              note: null,
              user: { id: 'user_1', name: '山田 太郎' },
              site: { id: 'site_1', name: '本店' },
            },
          ],
        },
        isLoading: false,
      };
    }

    return { data: { data: [] }, isLoading: false };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('ShiftsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires confirmation before deleting a shift template', () => {
    render(<ShiftsContent />);

    fireEvent.click(
      screen.getByRole('button', {
        name: '山田 太郎 / 月曜日 / 本店 / 勤務不可 の定型シフトを削除',
      }),
    );

    expect(mutationMutateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: '定型シフトを削除しますか' })).toBeTruthy();
    expect(
      screen.getByText(
        '山田 太郎 / 月曜日 / 本店 / 勤務不可 の定型シフトを削除します。この操作は取り消せません。対象月への反映前にテンプレート内容を確認してください。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    expect(mutationMutateMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'template_1' }));
  });

  it('requires confirmation before deleting a business holiday', () => {
    render(<ShiftsContent />);

    fireEvent.click(
      screen.getByRole('button', {
        name: '棚卸休業 / 2026年6月20日 / 本店 の休日設定を削除',
      }),
    );

    expect(mutationMutateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: '休日設定を削除しますか' })).toBeTruthy();
    expect(
      screen.getByText(
        '棚卸休業 / 2026年6月20日 / 本店 の休日設定を削除します。この操作は取り消せません。シフト表と訪問可能日の表示にも反映されます。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    expect(mutationMutateMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'holiday_1' }));
  });
});
