// @vitest-environment jsdom

import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { MentionInput } from './mention-input';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({
    'x-org-id': `org-header:${orgId}`,
    'x-test-helper': 'buildOrgHeaders',
  })),
);

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
}));

setupDomTestEnv();

function pharmacistListPayload(
  data: Array<Record<string, unknown>>,
  meta: Partial<{
    total_count: number;
    visible_count: number;
    hidden_count: number;
    truncated: boolean;
    count_basis: 'memberships' | 'unique_users';
    filters_applied: { site_id: string | null; include_collaborators: boolean };
    limit: number;
  }> = {},
) {
  return {
    data,
    meta: {
      total_count: data.length,
      visible_count: data.length,
      hidden_count: 0,
      truncated: false,
      count_basis: 'memberships' as const,
      filters_applied: { site_id: null, include_collaborators: false },
      limit: 500,
      ...meta,
    },
  };
}

function renderWithQueryClient(ui: React.ReactElement, queryClient = createTestQueryClient()) {
  return render(ui, { wrapper: createQueryClientWrapper(queryClient) });
}

describe('MentionInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    fetchMock.mockResolvedValue(jsonResponse(pharmacistListPayload([])));
  });

  it('fetches staff mention candidates through shared pharmacist path and org headers', async () => {
    renderWithQueryClient(
      <MentionInput
        value=""
        onChange={() => undefined}
        mentions={[]}
        onMentionsChange={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/pharmacists', {
        headers: { 'x-org-id': 'org-header:org_1', 'x-test-helper': 'buildOrgHeaders' },
      });
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('shows a PHI-safe recovery instead of an empty mention list when staff loading fails', async () => {
    const rawDetail = 'patient:患者A token=mention-staff-secret';
    fetchMock
      .mockRejectedValueOnce(new Error(rawDetail))
      .mockResolvedValueOnce(
        jsonResponse(pharmacistListPayload([{ id: 'staff_1', name: '田中' }])),
      );

    renderWithQueryClient(
      <MentionInput
        value=""
        onChange={() => undefined}
        mentions={[]}
        onMentionsChange={() => undefined}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '@', selectionStart: 1 },
    });

    expect(screen.getByText('メンション候補を表示できません')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'スタッフ候補を取得できませんでした。',
    );
    expect(screen.queryByText(rawDetail)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '候補を再読み込み' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /田中/ })).toBeTruthy());
    expect(screen.queryByText('メンション候補を表示できません')).toBeNull();
  });

  it('strips provider-only staff fields before mention candidates enter query state', async () => {
    const queryClient = createTestQueryClient();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        pharmacistListPayload([
          {
            id: 'staff_1',
            name: '田中',
            email: 'staff@example.com',
            phone: '03-1111-2222',
            account_status: 'active',
            max_daily_visits: 8,
            credential_types: ['認定薬剤師'],
          },
        ]),
      ),
    );

    renderWithQueryClient(
      <MentionInput
        value=""
        onChange={() => undefined}
        mentions={[]}
        onMentionsChange={() => undefined}
      />,
      queryClient,
    );

    await waitFor(() => {
      expect(queryClient.getQueryData(['staff-for-mentions', 'org_1'])).toBeTruthy();
    });

    const cached = queryClient.getQueryData<{
      data: Array<Record<string, unknown>>;
    }>(['staff-for-mentions', 'org_1']);
    expect(cached?.data).toEqual([{ id: 'staff_1', name: '田中' }]);
  });

  it('rejects legacy, count-drifted, and conflicting repeated staff payloads', async () => {
    const invalidPayloads = [
      { data: [{ id: 'staff_1', name: '田中' }] },
      pharmacistListPayload([{ id: 'staff_1', name: '田中' }], {
        visible_count: 0,
      }),
      pharmacistListPayload(
        [
          { id: 'staff_1', name: '田中' },
          { id: 'staff_1', name: '別名' },
        ],
        { total_count: 2 },
      ),
    ];

    for (const payload of invalidPayloads) {
      fetchMock.mockResolvedValueOnce(jsonResponse(payload));
      const { unmount } = renderWithQueryClient(
        <MentionInput
          value=""
          onChange={() => undefined}
          mentions={[]}
          onMentionsChange={() => undefined}
        />,
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: '@', selectionStart: 1 },
      });
      expect(await screen.findByText('メンション候補を表示できません')).toBeTruthy();
      unmount();
    }
  });
});

type StaffMember = { id: string; name: string };

function MentionHarness({
  initialValue,
  initialMentions,
  onMentionsChangeSpy,
}: {
  initialValue: string;
  initialMentions: string[];
  onMentionsChangeSpy: (mentions: string[]) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [mentions, setMentions] = useState(initialMentions);

  return (
    <MentionInput
      value={value}
      onChange={setValue}
      mentions={mentions}
      onMentionsChange={(next) => {
        onMentionsChangeSpy(next);
        setMentions(next);
      }}
    />
  );
}

async function renderWithLoadedStaff(
  staff: StaffMember[],
  props: {
    initialValue: string;
    initialMentions: string[];
    onMentionsChangeSpy: (m: string[]) => void;
  },
) {
  fetchMock.mockResolvedValue(jsonResponse(pharmacistListPayload(staff)));

  const queryClient = createTestQueryClient();

  render(<MentionHarness {...props} />, { wrapper: createQueryClientWrapper(queryClient) });

  // スタッフ一覧が react-query に確定するまで待つ（handleChange の除去判定は
  // 解決済み staffList を前提とするため）。
  await waitFor(() =>
    expect(queryClient.getQueryData(['staff-for-mentions', 'org_1'])).toBeTruthy(),
  );

  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

describe('MentionInput mention pruning on edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('removes a mention id when its @displayName is deleted from the body', async () => {
    // repro: 編集で @表示名 が本文から消えても mention id が残留するバグ。
    const onMentionsChangeSpy = vi.fn();
    const textarea = await renderWithLoadedStaff([{ id: 'staff_1', name: '田中' }], {
      initialValue: 'こんにちは @田中 です',
      initialMentions: ['staff_1'],
      onMentionsChangeSpy,
    });

    // ユーザーが @田中 を削除。
    fireEvent.change(textarea, {
      target: { value: 'こんにちは です', selectionStart: 7 },
    });

    expect(onMentionsChangeSpy).toHaveBeenCalledWith([]);
  });

  it('does not falsely keep a mention when the name is only a prefix of another mentioned name', async () => {
    // 部分一致の罠: 本文には @田中太郎 だけがあり、@田中 は境界を伴って存在しない。
    const onMentionsChangeSpy = vi.fn();
    const textarea = await renderWithLoadedStaff(
      [
        { id: 'staff_short', name: '田中' },
        { id: 'staff_long', name: '田中太郎' },
      ],
      {
        initialValue: 'メモ @田中太郎 確認',
        initialMentions: ['staff_short', 'staff_long'],
        onMentionsChangeSpy,
      },
    );

    // 何か1文字追記して handleChange を発火（本文の意味は変えない）。
    fireEvent.change(textarea, {
      target: { value: 'メモ @田中太郎 確認。', selectionStart: 12 },
    });

    // 田中(prefix) は境界付きで存在しないので除去、田中太郎 は保持。
    expect(onMentionsChangeSpy).toHaveBeenCalledWith(['staff_long']);
  });

  it('keeps a mention that is still present in the body', async () => {
    const onMentionsChangeSpy = vi.fn();
    const textarea = await renderWithLoadedStaff([{ id: 'staff_1', name: '田中太郎' }], {
      initialValue: '@田中太郎 メモ',
      initialMentions: ['staff_1'],
      onMentionsChangeSpy,
    });

    fireEvent.change(textarea, {
      target: { value: '@田中太郎 メモ書き', selectionStart: 12 },
    });

    expect(onMentionsChangeSpy).not.toHaveBeenCalled();
  });

  it('preserves mention ids that cannot be resolved from the staff list', async () => {
    // 既存コメント由来などで staffList に無い id は、本文から名前を判定できないため温存する。
    const onMentionsChangeSpy = vi.fn();
    const textarea = await renderWithLoadedStaff([{ id: 'staff_1', name: '田中' }], {
      initialValue: 'テキスト @田中 です',
      initialMentions: ['unknown_id'],
      onMentionsChangeSpy,
    });

    fireEvent.change(textarea, {
      target: { value: 'テキスト です', selectionStart: 5 },
    });

    expect(onMentionsChangeSpy).not.toHaveBeenCalled();
  });
});
