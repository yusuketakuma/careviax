// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PharmacistShift } from '@/lib/pharmacist-shifts/response-schema';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { ShiftsContent } from './shifts-content';
import { toTimeValue } from './shifts-content.shared';

setupDomTestEnv();

type CapturedMutation = {
  mutationFn: (...args: unknown[]) => unknown;
  onSuccess?: (...args: unknown[]) => unknown;
  onError?: (...args: unknown[]) => unknown;
};

type CapturedQuery = {
  queryKey: readonly unknown[];
  queryFn?: (...args: unknown[]) => Promise<unknown>;
  getNextPageParam?: (...args: unknown[]) => unknown;
};

type ShiftPageFixture = {
  data: PharmacistShift[];
  meta: { limit: number; has_more: boolean; next_cursor: string | null };
};

const mutationMutateMock = vi.hoisted(() => vi.fn());
const mutationConfigs = vi.hoisted(() => [] as CapturedMutation[]);
const queryConfigs = vi.hoisted(() => [] as CapturedQuery[]);
const fetchMock = vi.hoisted(() => vi.fn());
// Tests can mark specific query keys as failed (isError) to exercise the
// supporting-master fetch-error banner without touching the success-path tests.
const queryErrorKeys = vi.hoisted(() => new Set<string>());
const queryLoadingKeys = vi.hoisted(() => new Set<string>());
const refetchSpies = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
const shiftPages = vi.hoisted(() => ({
  data: {
    pages: [
      { data: [], meta: { limit: 400, has_more: false, next_cursor: null } },
    ] as ShiftPageFixture[],
    pageParams: [null] as Array<string | null>,
  },
}));
const fetchNextShiftPageMock = vi.hoisted(() => vi.fn());
const shiftNextPageError = vi.hoisted(() => ({ value: false }));
const shiftFetchingNextPage = vi.hoisted(() => ({ value: false }));
const shiftCachedError = vi.hoisted(() => ({ value: false }));
const shiftDataUpdatedAt = vi.hoisted(() => ({ value: 1 }));
const currentOrgId = vi.hoisted(() => ({ value: 'org_1' }));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => currentOrgId.value,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (config: CapturedMutation) => {
    mutationConfigs.push(config);
    return {
      mutate: mutationMutateMock,
      isPending: false,
    };
  },
  useQuery: (options: CapturedQuery) => {
    queryConfigs.push(options);
    const { queryKey } = options;
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
  useInfiniteQuery: (options: CapturedQuery) => {
    queryConfigs.push(options);
    const key = String(options.queryKey[0]);
    let refetch = refetchSpies.get(key);
    if (!refetch) {
      refetch = vi.fn();
      refetchSpies.set(key, refetch);
    }
    if (queryLoadingKeys.has(key)) {
      return {
        data: undefined,
        isLoading: true,
        isError: false,
        refetch,
        fetchNextPage: fetchNextShiftPageMock,
        hasNextPage: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
      };
    }
    if (queryErrorKeys.has(key) && shiftPages.data.pages.length === 0) {
      return {
        data: undefined,
        isLoading: false,
        isError: true,
        refetch,
        fetchNextPage: fetchNextShiftPageMock,
        hasNextPage: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
      };
    }
    const lastPage = shiftPages.data.pages.at(-1);
    return {
      data: shiftPages.data,
      dataUpdatedAt: shiftDataUpdatedAt.value,
      isLoading: false,
      isError: shiftCachedError.value || shiftNextPageError.value,
      refetch,
      fetchNextPage: fetchNextShiftPageMock,
      hasNextPage: lastPage?.meta.has_more ?? false,
      isFetchingNextPage: shiftFetchingNextPage.value,
      isFetchNextPageError: shiftNextPageError.value,
    };
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

function mutationFnAt(index: number) {
  const mutationFn = mutationConfigs[index]?.mutationFn;
  if (typeof mutationFn !== 'function') throw new Error(`Missing mutationFn at index ${index}`);
  return mutationFn;
}

function shiftItem(id: string, day: number, userId = 'user_1', monthOffset = 0) {
  const now = new Date();
  const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const month = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, '0')}`;
  return {
    id,
    site_id: 'site_1',
    user_id: userId,
    date: `${month}-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    available: true,
    available_from: '1970-01-01T09:00:00.000Z',
    available_to: '1970-01-01T18:00:00.000Z',
    note: null,
    user: { id: userId, name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
    site: { id: 'site_1', name: '本店' },
  };
}

describe('ShiftsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationConfigs.length = 0;
    queryConfigs.length = 0;
    queryErrorKeys.clear();
    queryLoadingKeys.clear();
    refetchSpies.clear();
    shiftPages.data = {
      pages: [{ data: [], meta: { limit: 400, has_more: false, next_cursor: null } }],
      pageParams: [null],
    };
    shiftNextPageError.value = false;
    shiftFetchingNextPage.value = false;
    shiftCachedError.value = false;
    shiftDataUpdatedAt.value = 1;
    currentOrgId.value = 'org_1';
    fetchNextShiftPageMock.mockReset();
    fetchMock.mockImplementation(async () => jsonResponse({ data: { id: 'template_saved' } }));
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

  it('retains loaded rows, marks unknown cells, and blocks edit/copy while the month is partial', () => {
    shiftPages.data = {
      pages: [
        {
          data: [shiftItem('shift_1', 1)],
          meta: { limit: 400, has_more: true, next_cursor: 'cursor_400' },
        },
      ],
      pageParams: [null],
    };
    fetchNextShiftPageMock.mockReturnValueOnce(new Promise(() => {}));

    render(<ShiftsContent />);

    expect(screen.getByRole('status').textContent).toContain('未読込または要確認');
    expect(screen.getAllByText('未確認').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'シフト編集' }).hasAttribute('disabled')).toBe(true);
    const copyButton = screen.getByRole('button', { name: '前月をコピー' });
    expect(copyButton.hasAttribute('disabled')).toBe(true);
    expect(copyButton.getAttribute('aria-describedby')).toBe(
      'shift-actions-unavailable-description',
    );
    expect(
      screen.getByRole('button', { name: 'シフト編集' }).getAttribute('aria-describedby'),
    ).toBe('shift-actions-unavailable-description');
    expect(document.getElementById('shift-actions-unavailable-description')?.textContent).toContain(
      '月間シフトの全件確認',
    );
    const loadMore = screen.getByRole('button', { name: 'さらに読み込む' });
    expect(loadMore.className).toContain('min-h-11');
    fireEvent.click(loadMore);
    fireEvent.click(loadMore);
    expect(fetchNextShiftPageMock).toHaveBeenCalledTimes(1);
  });

  it('retains loaded rows and retries the same continuation after a next-page failure', () => {
    shiftPages.data = {
      pages: [
        {
          data: [shiftItem('shift_1', 1)],
          meta: { limit: 400, has_more: true, next_cursor: 'cursor_400' },
        },
      ],
      pageParams: [null],
    };
    shiftNextPageError.value = true;

    render(<ShiftsContent />);

    expect(screen.getByText('続きのシフトを取得できませんでした')).toBeTruthy();
    expect(screen.getAllByText('未確認').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'さらに読み込む' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '続きを再試行' }));
    expect(fetchNextShiftPageMock).toHaveBeenCalledTimes(1);
  });

  it('stops a repeated continuation while retaining globally valid loaded rows', () => {
    shiftPages.data = {
      pages: [
        {
          data: [shiftItem('shift_1', 1)],
          meta: { limit: 400, has_more: true, next_cursor: 'cursor_400' },
        },
        {
          data: [shiftItem('shift_2', 2)],
          meta: { limit: 400, has_more: true, next_cursor: 'cursor_400' },
        },
      ],
      pageParams: [null, 'cursor_400'],
    };

    render(<ShiftsContent />);

    expect(screen.getByText('続きの読み込み位置が重複しました')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'さらに読み込む' })).toBeNull();
    expect(screen.getByRole('button', { name: 'シフト編集' }).hasAttribute('disabled')).toBe(true);
  });

  it('fails closed when an advancing cursor overlaps a prior page', () => {
    shiftPages.data = {
      pages: [
        {
          data: [shiftItem('shift_1', 1)],
          meta: { limit: 400, has_more: true, next_cursor: 'cursor_400' },
        },
        {
          data: [shiftItem('shift_1', 1)],
          meta: { limit: 400, has_more: false, next_cursor: null },
        },
      ],
      pageParams: [null, 'cursor_400'],
    };

    render(<ShiftsContent />);

    expect(screen.getByText('シフトの整合性を確認できませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'シフト編集' }).hasAttribute('disabled')).toBe(true);
  });

  it('keys continuation by monotonic scope generation across A-B-A', async () => {
    shiftPages.data = {
      pages: [
        {
          data: [shiftItem('shift_1', 1)],
          meta: { limit: 400, has_more: true, next_cursor: 'cursor_400' },
        },
      ],
      pageParams: [null],
    };
    let resolveOld: (() => void) | undefined;
    const oldRequest = new Promise<void>((resolve) => {
      resolveOld = resolve;
    });
    const requestB = new Promise<void>(() => {});
    const freshRequestA = new Promise<void>(() => {});
    fetchNextShiftPageMock
      .mockReturnValueOnce(oldRequest)
      .mockReturnValueOnce(requestB)
      .mockReturnValueOnce(freshRequestA);
    const view = render(<ShiftsContent />);

    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
    currentOrgId.value = 'org_2';
    view.rerender(<ShiftsContent />);
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
    expect(fetchNextShiftPageMock).toHaveBeenCalledTimes(2);

    currentOrgId.value = 'org_1';
    view.rerender(<ShiftsContent />);
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
    expect(fetchNextShiftPageMock).toHaveBeenCalledTimes(3);

    resolveOld?.();
    await oldRequest;
    await Promise.resolve();
    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));
    expect(fetchNextShiftPageMock).toHaveBeenCalledTimes(3);
  });

  it('releases a rejected continuation guard so the same cursor can retry', async () => {
    shiftPages.data = {
      pages: [
        {
          data: [shiftItem('shift_1', 1)],
          meta: { limit: 400, has_more: true, next_cursor: 'cursor_400' },
        },
      ],
      pageParams: [null],
    };
    fetchNextShiftPageMock.mockRejectedValueOnce(new Error('unsafe provider detail'));
    render(<ShiftsContent />);

    const loadMore = screen.getByRole('button', { name: 'さらに読み込む' });
    fireEvent.click(loadMore);
    await waitFor(() => expect(fetchNextShiftPageMock).toHaveBeenCalledTimes(1));
    fireEvent.click(loadMore);
    expect(fetchNextShiftPageMock).toHaveBeenCalledTimes(2);
  });

  it('encodes special cursor characters and stops a repeated cursor in getNextPageParam', async () => {
    render(<ShiftsContent />);
    const query = queryConfigs.find((config) => config.queryKey[0] === 'pharmacist-shifts');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [], meta: { limit: 400, has_more: false, next_cursor: null } }),
    );

    await query?.queryFn?.({ pageParam: 'a+b/=' });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('cursor=a%2Bb%2F%3D');

    const firstPage = {
      data: [shiftItem('shift_1', 1)],
      meta: { limit: 400, has_more: true, next_cursor: 'same_cursor' },
    };
    const secondPage = {
      data: [shiftItem('shift_2', 2)],
      meta: { limit: 400, has_more: true, next_cursor: 'same_cursor' },
    };
    expect(
      query?.getNextPageParam?.(secondPage, [firstPage, secondPage], 'same_cursor', [
        null,
        'same_cursor',
      ]),
    ).toBeUndefined();
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

  it('preserves server messages and operation fallbacks for shift admin mutations', async () => {
    render(<ShiftsContent />);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: '休日設定の作成権限がありません' }, 403),
    );
    await expect(mutationFnAt(1)()).rejects.toThrow('休日設定の作成権限がありません');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '休日設定の削除権限がありません' }, 403));
    await expect(mutationFnAt(3)({ id: 'holiday_1', name: '棚卸休業' })).rejects.toThrow(
      '休日設定の削除権限がありません',
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '薬剤師登録の権限がありません' }, 403));
    await expect(mutationFnAt(4)()).rejects.toThrow('薬剤師登録の権限がありません');

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 500 }));
    await expect(
      mutationFnAt(6)({
        pharmacist: { id: 'user_1', name: '山田 太郎' },
        action: 'suspend',
      }),
    ).rejects.toThrow('薬剤師状態の更新に失敗しました');

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: '前月シフトの閲覧権限がありません' }, 403),
    );
    await expect(mutationFnAt(7)()).rejects.toThrow('前月シフトの取得に失敗しました');

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 500 }));
    await expect(mutationFnAt(8)()).rejects.toThrow('定型シフトの保存に失敗しました');

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: '定型シフトの削除権限がありません' }, 403),
    );
    await expect(mutationFnAt(9)({ id: 'template_1' })).rejects.toThrow(
      '定型シフトの削除権限がありません',
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: '定型シフトの反映権限がありません' }, 403),
    );
    await expect(mutationFnAt(10)()).rejects.toThrow('定型シフトの反映権限がありません');
  });
});
