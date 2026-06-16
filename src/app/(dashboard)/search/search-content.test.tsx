// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}));

vi.stubGlobal('fetch', fetchMock);

import { SearchContent } from './search-content';

setupDomTestEnv();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse<T>(data: T, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve({ data }),
  });
}

const PATIENT_RESULTS = [
  {
    id: 'patient_1',
    name: '田中 一郎',
    conditions: [{ name: '心不全', is_primary: true }],
    visit_schedules: [{ scheduled_date: '2026-06-17' }],
  },
];

const DRUG_RESULTS = [
  { id: 'drug_1', drug_name: 'アムロジピン錠', yj_code: '2171013F1024', generic_name: null },
];

function setupFetchMocks(overrides: Partial<Record<string, unknown>> = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/api/pharmacists')) return makeJsonResponse([]);
    if (url.includes('/api/patients')) {
      return makeJsonResponse(overrides.patients ?? PATIENT_RESULTS);
    }
    if (url.includes('/api/prescription-intakes')) return makeJsonResponse([]);
    if (url.includes('/api/drug-masters')) {
      return makeJsonResponse(overrides.drugs ?? DRUG_RESULTS);
    }
    if (url.includes('/api/facilities')) return makeJsonResponse([]);
    if (url.includes('/api/care-reports')) return makeJsonResponse([]);
    if (url.includes('/api/contact-profiles')) return makeJsonResponse([]);
    return makeJsonResponse([]);
  });
}

/** Trigger debounce and allow all pending promises to resolve. */
async function triggerSearch(query: string) {
  const input = screen.getByPlaceholderText(/田中 一郎/);
  fireEvent.change(input, { target: { value: query } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useOrgIdMock.mockReturnValue('org_1');
  useRouterMock.mockReturnValue({ replace: vi.fn(), push: vi.fn() });
  useSearchParamsMock.mockReturnValue(new URLSearchParams());
  setupFetchMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchContent', () => {
  it('renders heading, search box, and category chips', () => {
    render(<SearchContent />);

    expect(screen.getByRole('heading', { name: '全体検索' })).toBeTruthy();
    expect(screen.getByPlaceholderText(/田中 一郎 アムロジピン/)).toBeTruthy();

    for (const chip of ['患者', '処方カード', '薬剤', '施設', '報告書', '連絡先']) {
      expect(screen.getByRole('button', { name: new RegExp(chip) })).toBeTruthy();
    }
  });

  it('shows empty state guide when query is blank', () => {
    render(<SearchContent />);
    expect(screen.getByText('キーワードを入力して横断検索')).toBeTruthy();
  });

  it('fetches and shows patient results after debounce', async () => {
    render(<SearchContent />);
    await triggerSearch('田中');

    expect(screen.getAllByTestId('list-open-card').length).toBeGreaterThan(0);
    expect(screen.getByText('田中 一郎 様')).toBeTruthy();
  });

  it('switching chip shows results for the new category', async () => {
    render(<SearchContent />);
    await triggerSearch('アムロジピン');

    // Switch to drug chip and verify drug results appear
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /薬剤/ }));
    });

    expect(screen.getByText('アムロジピン錠')).toBeTruthy();
    // Patient results are not visible when drug chip is selected
    expect(screen.queryByText('田中 一郎 様')).toBeNull();
  });

  it('renders ListOpenCard with badge, title, and 開く button', async () => {
    render(<SearchContent />);
    await triggerSearch('田中');

    expect(screen.getByText('田中 一郎 様')).toBeTruthy();
    // '患者' appears both in the chip and the card badge
    expect(screen.getAllByText('患者').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: '開く' })).toBeTruthy();
  });

  it('opens advanced filter modal when 詳しく絞り込む is clicked', async () => {
    render(<SearchContent />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '詳しく絞り込む' }));
    });

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '詳しく絞り込む' })).toBeTruthy();
  });

  it('shows current set-audit status wording in the advanced filter modal', async () => {
    render(<SearchContent />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '詳しく絞り込む' }));
    });

    expect(screen.getByText('セット監査待ち / セット監査済み')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('combobox')[2]);
    });

    expect(screen.getByRole('option', { name: 'セット監査待ち' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'セット監査済み' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'セット中' })).toBeNull();
  });

  it('applies connected care tag filters to prescription search requests', async () => {
    render(<SearchContent />);
    await triggerSearch('田中');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '詳しく絞り込む' }));
    });

    expect(screen.queryByRole('button', { name: '処方変更' })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '麻薬' }));
      fireEvent.click(screen.getByRole('button', { name: '冷所' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'この条件で探す' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const prescriptionUrls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/api/prescription-intakes'));
    expect(prescriptionUrls.at(-1)).toContain('care_tags=narcotic%2Ccold_storage');
  });

  it('modal リセット does not close modal', async () => {
    render(<SearchContent />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '詳しく絞り込む' }));
    });

    expect(screen.getByRole('dialog')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'リセット' }));
    });

    // Modal remains open after reset
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows no-result message when query has no matches', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/pharmacists')) return makeJsonResponse([]);
      return makeJsonResponse([]);
    });

    render(<SearchContent />);
    await triggerSearch('zzznomatch');

    expect(screen.getByText('一致する結果がありません')).toBeTruthy();
  });
});
