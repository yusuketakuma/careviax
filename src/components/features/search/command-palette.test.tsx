// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { UseGlobalSearchResult } from './use-global-search';
import { CommandPalette } from './command-palette';

const mockPush = vi.fn();
const mockClose = vi.fn();
const useGlobalSearchMock = vi.fn<() => UseGlobalSearchResult>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));
vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: () => 'org_1' }));
vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { currentUser: { role: string } }) => unknown) =>
    selector({ currentUser: { role: 'admin' } }),
}));
vi.mock('@/lib/stores/command-palette-store', () => ({
  useCommandPaletteStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      open: true,
      focusNonce: 0,
      restoreEl: null,
      openPalette: vi.fn(),
      closePalette: mockClose,
    }),
}));
vi.mock('./use-global-search', () => ({ useGlobalSearch: () => useGlobalSearchMock() }));

setupDomTestEnv();

const row = (
  over: Partial<{ id: string; title: string; subtitle: string | null; href: string }>,
) => ({
  id: over.id ?? 'x',
  badgeLabel: '患者',
  badgeClassName: 'bg-blue-50',
  title: over.title ?? 'タイトル',
  subtitle: over.subtitle ?? null,
  href: over.href ?? '/x',
});

function withResults(over: Partial<UseGlobalSearchResult>): UseGlobalSearchResult {
  return { results: [], loading: false, pending: false, hasQuery: true, ...over };
}

const TWO_GROUPS = withResults({
  results: [
    {
      category: 'patient',
      label: '患者',
      status: 'ok',
      rows: [row({ id: 'p1', title: '山田 太郎 様', subtitle: '高血圧', href: '/patients/p1' })],
    },
    {
      category: 'prescription',
      label: '処方カード',
      status: 'ok',
      bestEffort: true,
      bestEffortNote: '暫定（部分一致）',
      rows: [row({ id: 'rx1', title: 'RX-001', href: '/prescriptions/rx1' })],
    },
  ],
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CommandPalette', () => {
  it('renders category groups and option accessible names (category + title + subtitle)', () => {
    useGlobalSearchMock.mockReturnValue(TWO_GROUPS);
    render(<CommandPalette />);

    expect(screen.getAllByText('患者').length).toBeGreaterThan(0);
    expect(screen.getByText('処方カード')).toBeTruthy();

    const option = screen.getByRole('option', { name: '患者 山田 太郎 様 高血圧' });
    expect(option).toBeTruthy();
    // combobox wiring
    const input = screen.getByRole('combobox');
    expect(input.getAttribute('aria-controls')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(option.getAttribute('aria-selected')).toBe('true');
  });

  it('moves aria-activedescendant with ArrowDown/ArrowUp across the flat options', () => {
    useGlobalSearchMock.mockReturnValue(TWO_GROUPS);
    render(<CommandPalette />);
    const input = screen.getByRole('combobox');
    const options = screen.getAllByRole('option');

    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
  });

  it('navigates to the active option href on Enter and closes', () => {
    useGlobalSearchMock.mockReturnValue(TWO_GROUPS);
    render(<CommandPalette />);
    const input = screen.getByRole('combobox');

    fireEvent.keyDown(input, { key: 'ArrowDown' }); // -> prescription
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockPush).toHaveBeenCalledWith('/prescriptions/rx1');
    expect(mockClose).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    useGlobalSearchMock.mockReturnValue(TWO_GROUPS);
    render(<CommandPalette />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(mockClose).toHaveBeenCalled();
  });

  it('labels the best-effort group as partial', () => {
    useGlobalSearchMock.mockReturnValue(TWO_GROUPS);
    render(<CommandPalette />);
    expect(screen.getByText('暫定（部分一致）')).toBeTruthy();
  });

  it('shows a per-category failure as a static alert without raw error / PHI', () => {
    useGlobalSearchMock.mockReturnValue(
      withResults({
        results: [
          {
            category: 'patient',
            label: '患者',
            status: 'ok',
            rows: [row({ id: 'p1', title: '山田 太郎 様', href: '/patients/p1' })],
          },
          { category: 'report', label: '報告書', status: 'failed', rows: [] },
        ],
      }),
    );
    render(<CommandPalette />);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('報告書の取得に失敗しました')).toBeTruthy();
    // patient group still renders; the failure is isolated.
    expect(screen.getByRole('option', { name: /山田 太郎/ })).toBeTruthy();
  });

  it('shows the min-char hint when the query is too short', () => {
    useGlobalSearchMock.mockReturnValue(withResults({ hasQuery: false }));
    render(<CommandPalette />);
    expect(screen.getByText(/2文字以上のキーワード/)).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows an empty state when there are results-eligible queries but no matches', () => {
    useGlobalSearchMock.mockReturnValue(
      withResults({ results: [], hasQuery: true, pending: false, loading: false }),
    );
    render(<CommandPalette />);
    expect(screen.getByText('一致する結果がありません')).toBeTruthy();
  });

  it('shows a visible loading state while pending (no false-empty, no rows)', () => {
    // pending=true (debounce/fetch 未完了 or stale)。古い結果や空状態を出してはいけない。
    useGlobalSearchMock.mockReturnValue(
      withResults({ results: [], hasQuery: true, pending: true }),
    );
    render(<CommandPalette />);

    expect(screen.getByTestId('command-palette-loading')).toBeTruthy();
    expect(screen.queryByText('一致する結果がありません')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not expose or navigate to stale rows while pending', () => {
    // pending 中は results があっても露出しない & Enter で遷移しない(stale 防止)。
    useGlobalSearchMock.mockReturnValue(
      withResults({
        pending: true,
        results: [
          {
            category: 'patient',
            label: '患者',
            status: 'ok',
            rows: [row({ id: 'p1', title: '山田 太郎 様', href: '/patients/p1' })],
          },
        ],
      }),
    );
    render(<CommandPalette />);

    // 古い行は出ない
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByTestId('command-palette-loading')).toBeTruthy();
    // Enter を押しても遷移しない
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not expose or navigate to stale rows once the query drops below the minimum', () => {
    // query が 2 文字未満に落ちた瞬間: hasQuery=false, pending=false。古い結果を露出/遷移させない。
    useGlobalSearchMock.mockReturnValue(
      withResults({
        hasQuery: false,
        pending: false,
        results: [
          {
            category: 'patient',
            label: '患者',
            status: 'ok',
            rows: [row({ id: 'p1', title: '山田 太郎 様', href: '/patients/p1' })],
          },
        ],
      }),
    );
    render(<CommandPalette />);

    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('uses count-aware copy: multi-active categories use 「横断検索」 and list active labels', () => {
    useGlobalSearchMock.mockReturnValue(withResults({ hasQuery: false }));
    render(<CommandPalette />);

    const input = screen.getByRole('combobox') as HTMLInputElement;
    const aria = input.getAttribute('aria-label') ?? '';
    const intro = screen.getByText(/2文字以上のキーワード/).textContent ?? '';

    // 全6カテゴリ active のため「横断検索」表記、active ラベル(患者/薬剤)を案内。
    expect(input.placeholder).toContain('患者');
    expect(input.placeholder).toContain('薬剤');
    expect(aria).toContain('横断検索');
    expect(intro).toContain('横断検索');
    // active は確定列挙なので「など」は付けない(除外カテゴリも検索できると誤認させない)。
    expect(aria).not.toContain('など');
    expect(intro).not.toContain('など');
    expect(input.placeholder).not.toContain('など');
  });

  it('only wires aria-controls to the listbox when results are actually rendered', () => {
    // listbox DOM が無い状態(初期案内/pending/empty)では combobox は存在しない id を指さない。
    // 1) 初期案内(hasQuery=false)
    useGlobalSearchMock.mockReturnValue(withResults({ hasQuery: false }));
    const hint = render(<CommandPalette />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox').getAttribute('aria-controls')).toBeNull();
    hint.unmount();

    // 2) pending(ローディングのみ)
    useGlobalSearchMock.mockReturnValue(withResults({ hasQuery: true, pending: true }));
    const loading = render(<CommandPalette />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox').getAttribute('aria-controls')).toBeNull();
    loading.unmount();

    // 3) empty(検索完了0件)
    useGlobalSearchMock.mockReturnValue(
      withResults({ results: [], hasQuery: true, pending: false }),
    );
    const empty = render(<CommandPalette />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox').getAttribute('aria-controls')).toBeNull();
    empty.unmount();

    // 4) results 有り: listbox が描画され、aria-controls はその listbox id を指す。
    useGlobalSearchMock.mockReturnValue(TWO_GROUPS);
    render(<CommandPalette />);
    const listbox = screen.getByRole('listbox');
    expect(listbox.id).toBeTruthy();
    expect(screen.getByRole('combobox').getAttribute('aria-controls')).toBe(listbox.id);
  });

  it('renders a 44px accessible close button that closes the palette on click', () => {
    useGlobalSearchMock.mockReturnValue(withResults({ hasQuery: false }));
    render(<CommandPalette />);

    const close = screen.getByRole('button', { name: '閉じる' });
    expect(close.className).toContain('min-h-[44px]');
    expect(close.className).toContain('min-w-[44px]');

    fireEvent.click(close);
    expect(mockClose).toHaveBeenCalled();
  });
});
