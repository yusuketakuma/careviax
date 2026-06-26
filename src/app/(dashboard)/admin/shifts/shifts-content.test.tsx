// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('prioritizes the monthly calendar before secondary summaries and uses full-size primary controls', () => {
    const { container } = render(<ShiftsContent />);

    const calendarHeading = screen.getByText('月間シフトカレンダー');
    const candidateSummary = screen.getByText('シフト候補');
    expect(
      calendarHeading.compareDocumentPosition(candidateSummary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    for (const name of ['メンバー招待', '前月をコピー', 'シフト編集']) {
      const className = screen.getByRole('button', { name }).getAttribute('class') ?? '';
      expect(className).toContain('h-11');
      expect(className).toContain('min-h-[44px]');
      expect(className).toContain('sm:h-11');
      expect(className).toContain('sm:min-h-[44px]');
    }

    expect(screen.getByRole('button', { name: '前月' }).getAttribute('class')).toContain('size-11');
    expect(screen.getByRole('button', { name: '前月' }).getAttribute('class')).toContain(
      'sm:size-11',
    );
    expect(screen.getByRole('button', { name: '翌月' }).getAttribute('class')).toContain('size-11');
    expect(screen.getByRole('button', { name: '翌月' }).getAttribute('class')).toContain(
      'sm:size-11',
    );
    expect(container.textContent).not.toContain('Pharmacist Operations');
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

  it('names repeated shift management actions by target', () => {
    render(<ShiftsContent />);

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎 のメンバー情報を編集' }));

    const memberDialog = screen.getByRole('dialog', { name: 'メンバー情報を編集' });
    expect(memberDialog).toBeTruthy();
    expect((screen.getByLabelText('氏名') as HTMLInputElement).value).toBe('山田 太郎');

    fireEvent.click(within(memberDialog).getByText('閉じる', { selector: 'button' }));
    fireEvent.click(screen.getByRole('button', { name: '山田 太郎 を停止' }));

    const actionDialog = screen.getByRole('dialog', { name: '薬剤師を停止' });
    expect(actionDialog).toBeTruthy();
    expect(screen.getByText('山田 太郎 の状態を更新します。')).toBeTruthy();

    fireEvent.click(within(actionDialog).getByText('閉じる', { selector: 'button' }));
    expect(screen.getByRole('button', { name: '山田 太郎 を退職処理' })).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: '山田 太郎 / 月曜日 / 本店 / 勤務不可 の定型シフトを編集',
      }),
    );

    expect(screen.getByRole('button', { name: '定型シフトを更新' })).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: '棚卸休業 / 2026年6月20日 / 本店 の休日設定を編集',
      }),
    );

    const holidayDialog = screen.getByRole('dialog', { name: '休日設定を編集' });
    expect(holidayDialog).toBeTruthy();
    expect((within(holidayDialog).getByLabelText('休日名') as HTMLInputElement).value).toBe(
      '棚卸休業',
    );
  });

  it('renders monthly shift cells as keyboard-accessible buttons in edit mode', async () => {
    render(<ShiftsContent />);

    expect(screen.queryByText(/山田 太郎 \/ \d{4}年\d+月\d+日\(.+\)/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'シフト編集' }));
    const editableCells = await screen.findAllByRole('button', {
      name: /山田 太郎 \/ \d{4}年\d+月\d+日\(.+\) \/ 本店 \/ .* を編集/,
    });

    expect(editableCells[0].tagName).toBe('BUTTON');
    expect(editableCells[0].getAttribute('aria-label')).not.toContain('患者');
    fireEvent.click(editableCells[0]);

    expect(await screen.findByText(/山田 太郎 \/ \d{4}年\d+月\d+日\(.+\)/)).toBeTruthy();
  });
});
