// @vitest-environment jsdom

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
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

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('MentionInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
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
  props: { initialValue: string; initialMentions: string[]; onMentionsChangeSpy: (m: string[]) => void },
) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: staff }) });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MentionHarness {...props} />
    </QueryClientProvider>,
  );

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
