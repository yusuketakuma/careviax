// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ShiftsContent } from './shifts-content';
import { toTimeValue } from './shifts-content.shared';

setupDomTestEnv();

type CapturedMutation = {
  mutationFn: () => unknown;
};

const mutationMutateMock = vi.hoisted(() => vi.fn());
const mutationConfigs = vi.hoisted(() => [] as CapturedMutation[]);
const fetchMock = vi.hoisted(() => vi.fn());
// Tests can mark specific query keys as failed (isError) to exercise the
// supporting-master fetch-error banner without touching the success-path tests.
const queryErrorKeys = vi.hoisted(() => new Set<string>());
const queryLoadingKeys = vi.hoisted(() => new Set<string>());
const refetchSpies = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (config: CapturedMutation) => {
    mutationConfigs.push(config);
    return {
      mutate: mutationMutateMock,
      isPending: false,
    };
  },
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = String(queryKey[0]);

    let refetch = refetchSpies.get(key);
    if (!refetch) {
      refetch = vi.fn();
      refetchSpies.set(key, refetch);
    }

    if (queryErrorKeys.has(key)) {
      return { data: undefined, isLoading: false, isError: true, refetch };
    }

    if (queryLoadingKeys.has(key)) {
      return { data: undefined, isLoading: true, isError: false, refetch };
    }

    const success = (data: unknown) => ({ data, isLoading: false, isError: false, refetch });

    if (key === 'pharmacy-sites') {
      return success({ data: [{ id: 'site_1', name: '本店', address: '東京都' }] });
    }

    if (key === 'pharmacists') {
      return success({
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
      });
    }

    if (key === 'pharmacist-shifts') {
      return success({ data: [] });
    }

    if (key === 'business-holidays') {
      return success({
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
      });
    }

    if (key === 'pharmacist-shift-templates') {
      return success({
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
      });
    }

    return success({ data: [] });
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

async function runUpsertTemplateMutationAndReadBody() {
  for (let index = mutationConfigs.length - 1; index >= 0; index -= 1) {
    fetchMock.mockClear();
    try {
      await mutationConfigs[index]?.mutationFn();
    } catch {
      // Other captured mutations can require arguments or selected records.
    }

    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    if (call?.[0] === '/api/pharmacist-shift-templates') {
      const init = call[1] as RequestInit;
      return JSON.parse(String(init.body)) as Record<string, unknown>;
    }
  }

  throw new Error('upsert template mutation was not captured');
}

describe('ShiftsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationConfigs.length = 0;
    queryErrorKeys.clear();
    queryLoadingKeys.clear();
    refetchSpies.clear();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'template_saved' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
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

  it('keeps @db.Time shift reader values on lexical clock time across offsets', () => {
    expect(toTimeValue('1970-01-01T09:00:00.000Z')).toBe('09:00');
    expect(toTimeValue('1970-01-01T09:00:00.000+09:00')).toBe('09:00');
    expect(toTimeValue('1970-01-01T09:00:00.000-08:00')).toBe('09:00');
    expect(toTimeValue('1970-01-01T09:00:00.000-0800')).toBe('09:00');
  });

  it('uses an announced skeleton while shift data is loading', () => {
    queryLoadingKeys.add('pharmacist-shifts');

    render(<ShiftsContent />);

    expect(screen.getByRole('status', { name: 'シフトを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('シフトを読み込んでいます...')).toBeNull();
    expect(screen.queryByText('シフト対象メンバーが登録されていません')).toBeNull();
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

  it('builds the weekly template create payload from RHF defaults and existing fallbacks', async () => {
    render(<ShiftsContent />);

    expect(await runUpsertTemplateMutationAndReadBody()).toEqual({
      user_id: 'user_1',
      site_id: 'site_1',
      weekday: 1,
      available: true,
      available_from: '09:00',
      available_to: '18:00',
    });
  });

  it('builds the weekly template update payload after loading an existing template', async () => {
    render(<ShiftsContent />);

    fireEvent.click(
      screen.getByRole('button', {
        name: '山田 太郎 / 月曜日 / 本店 / 勤務不可 の定型シフトを編集',
      }),
    );
    fireEvent.change(screen.getByLabelText('備考'), {
      target: { value: '  午後は施設対応  ' },
    });

    expect(await runUpsertTemplateMutationAndReadBody()).toEqual({
      user_id: 'user_1',
      site_id: 'site_1',
      weekday: 1,
      available: false,
      note: '  午後は施設対応  ',
    });
  });

  it('retains disabled time values but omits them from unavailable weekly template payloads', async () => {
    render(<ShiftsContent />);

    const availableCheckbox = screen.getByRole('checkbox', {
      name: 'この曜日を勤務可として扱う',
    });
    const fromInput = screen.getByLabelText('開始時刻') as HTMLInputElement;
    const toInput = screen.getByLabelText('終了時刻') as HTMLInputElement;
    expect(fromInput.value).toBe('09:00');
    expect(toInput.value).toBe('18:00');

    fireEvent.click(availableCheckbox);

    expect(fromInput.value).toBe('09:00');
    expect(toInput.value).toBe('18:00');
    expect(fromInput.disabled).toBe(true);
    expect(toInput.disabled).toBe(true);

    expect(await runUpsertTemplateMutationAndReadBody()).toEqual({
      user_id: 'user_1',
      site_id: 'site_1',
      weekday: 1,
      available: false,
    });
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

  it('does not surface the supporting-master warning when sites, holidays, and templates all load', () => {
    render(<ShiftsContent />);
    expect(screen.queryByText(/を取得できませんでした/)).toBeNull();
  });

  it('surfaces a retryable warning instead of empty pickers when supporting masters fail to load', () => {
    queryErrorKeys.add('pharmacy-sites');
    queryErrorKeys.add('business-holidays');
    queryErrorKeys.add('pharmacist-shift-templates');
    render(<ShiftsContent />);

    expect(screen.getByText(/店舗情報・休日設定・定型シフトを取得できませんでした/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies.get('pharmacy-sites')).toHaveBeenCalled();
    expect(refetchSpies.get('business-holidays')).toHaveBeenCalled();
    expect(refetchSpies.get('pharmacist-shift-templates')).toHaveBeenCalled();
  });

  it('warns that the site picker is unavailable rather than empty when only the site lookup fails', () => {
    queryErrorKeys.add('pharmacy-sites');
    render(<ShiftsContent />);

    expect(screen.getByText(/店舗情報を取得できませんでした/)).toBeTruthy();
    expect(screen.getByText(/「店舗が未登録」ではなく取得エラーです/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies.get('pharmacy-sites')).toHaveBeenCalled();
  });
});
