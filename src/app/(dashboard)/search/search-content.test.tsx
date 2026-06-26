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

const PROPOSAL_RESULTS = [
  {
    id: 'proposal_1',
    proposal_status: 'patient_contact_pending',
    patient_contact_status: 'pending',
    proposed_date: '2026-06-18',
    time_window_start: '2026-06-18T09:00:00.000+09:00',
    time_window_end: '2026-06-18T10:00:00.000+09:00',
    proposed_pharmacist: { name: '佐藤 薬剤師' },
    case_: { patient: { id: 'patient_1', name: '田中 一郎' } },
  },
];

const MEDICATION_DEADLINE_RESULTS = {
  total: 1,
  critical: {
    count: 1,
    items: [
      {
        id: 'schedule_1',
        case_id: 'case_1',
        scheduled_date: '2026-06-18T00:00:00.000Z',
        medication_end_date: '2026-06-20T00:00:00.000Z',
        visit_type: 'regular',
        pharmacist_id: 'user_1',
        case_: { patient: { id: 'patient_1', name: '田中 一郎' } },
      },
    ],
  },
  warning: { count: 0, items: [] },
};

function setupFetchMocks(overrides: Partial<Record<string, unknown>> = {}) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/api/pharmacists')) return makeJsonResponse([]);
    if (url.includes('/api/patients')) {
      return makeJsonResponse(overrides.patients ?? PATIENT_RESULTS);
    }
    if (url.includes('/api/visit-schedule-proposals')) {
      return makeJsonResponse(overrides.proposals ?? []);
    }
    if (url.includes('/api/dashboard/medication-deadlines')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(overrides.medicationDeadlines ?? MEDICATION_DEADLINE_RESULTS),
      });
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
  const input = screen.getByLabelText('全体検索キーワード');
  fireEvent.change(input, { target: { value: query } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

async function flushInitialEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
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
  it('renders heading, search box, and category chips', async () => {
    render(<SearchContent />);
    await flushInitialEffects();

    expect(screen.getByRole('heading', { name: '全体検索' })).toBeTruthy();
    expect(screen.getByLabelText('全体検索キーワード')).toBeTruthy();
    expect(screen.getByPlaceholderText(/田中 一郎 アムロジピン/)).toBeTruthy();
    expect(screen.getByText('キーワード入力待ち')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '検索結果' })).toBeTruthy();
    expect(screen.getByLabelText('全体検索キーワード').className).toContain('sm:h-12');
    expect(screen.getByRole('button', { name: '詳しく絞り込む' }).className).toContain('!min-h-11');

    for (const chip of [
      '患者',
      '訪問候補',
      '処方カード',
      '薬切れ',
      '薬剤',
      '施設',
      '報告書',
      '連絡先',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(chip) })).toBeTruthy();
    }
  });

  it('shows empty state guide when query is blank', async () => {
    render(<SearchContent />);
    await flushInitialEffects();
    expect(screen.getByText('キーワードを入力して横断検索')).toBeTruthy();
  });

  it('fetches and shows patient results after debounce', async () => {
    render(<SearchContent />);
    await triggerSearch('田中');

    expect(screen.getByText(/患者 1件 \/ 全カテゴリ/)).toBeTruthy();
    expect(screen.getAllByTestId('list-open-card').length).toBeGreaterThan(0);
    expect(screen.getByText('田中 一郎 様')).toBeTruthy();
  });

  it('uses minimal search contracts where they preserve /search row content', async () => {
    render(<SearchContent />);
    await triggerSearch('田中');

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    const patientUrl = urls.find((url) => url.includes('/api/patients'));
    const proposalUrl = urls.find((url) => url.includes('/api/visit-schedule-proposals'));
    const reportUrl = urls.find((url) => url.includes('/api/care-reports'));
    const contactUrl = urls.find((url) => url.includes('/api/contact-profiles'));

    // The dedicated /search page uses a middle projection that keeps the
    // condition/next-visit fields required for the row subtitle without the full
    // patient-list enrichment payload.
    expect(patientUrl).toContain('view=search');
    expect(patientUrl).toContain('limit=8');
    expect(proposalUrl).toContain('view=palette');
    expect(proposalUrl).toContain('limit=8');
    expect(reportUrl).toContain('view=palette');
    expect(reportUrl).toContain('limit=8');
    expect(contactUrl).toContain('limit=8');
  });

  it('keeps rich patient subtitles when optimizing backend search contracts', async () => {
    render(<SearchContent />);
    await triggerSearch('田中');

    expect(screen.getByText('心不全。次回訪問 6/17')).toBeTruthy();
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
    expect(screen.getByRole('button', { name: '開く' }).className).toContain('min-h-11');
  });

  it('shows visit schedule proposal results through the existing proposal API', async () => {
    setupFetchMocks({ proposals: PROPOSAL_RESULTS });
    render(<SearchContent />);
    await triggerSearch('田中');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /訪問候補/ }));
    });

    expect(screen.getByText('田中 一郎 様の訪問候補')).toBeTruthy();
    const proposalUrls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/api/visit-schedule-proposals'));
    expect(proposalUrls.at(-1)).toContain('q=%E7%94%B0%E4%B8%AD');
    expect(proposalUrls.at(-1)).toContain('view=palette');
    expect(proposalUrls.at(-1)).toContain('limit=8');
  });

  it('fetches medication deadline results only when the deadline filter is applied', async () => {
    render(<SearchContent />);
    await triggerSearch('田中');

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/api/dashboard/medication-deadlines'),
      ),
    ).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '詳しく絞り込む' }));
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('combobox')[4]);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: '3日以内' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'この条件で探す' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /薬切れ/ }));
    });

    expect(screen.getByText('田中 一郎 様の薬切れ予定')).toBeTruthy();
    const medicationDeadlineUrls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/api/dashboard/medication-deadlines'));
    expect(medicationDeadlineUrls.at(-1)).toContain('within_days=3');
    expect(medicationDeadlineUrls.at(-1)).toContain('q=%E7%94%B0%E4%B8%AD');
    expect(medicationDeadlineUrls.at(-1)).toContain('limit=8');
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

  it('applies proposal status to visit schedule proposal search requests', async () => {
    render(<SearchContent />);
    await triggerSearch('田中');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '詳しく絞り込む' }));
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('combobox')[3]);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: '患者確認待ち' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'この条件で探す' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const proposalUrls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('/api/visit-schedule-proposals'));
    expect(proposalUrls.at(-1)).toContain('status=patient_contact_pending');
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

  it('shows partial failure feedback while keeping successful category results available', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/pharmacists')) return makeJsonResponse([]);
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ message: 'failed' }),
        });
      }
      if (url.includes('/api/drug-masters')) return makeJsonResponse(DRUG_RESULTS);
      return makeJsonResponse([]);
    });

    render(<SearchContent />);
    await triggerSearch('アムロジピン');

    const partialFailureStatus = screen
      .getAllByRole('status')
      .find((element) => element.textContent?.includes('一部の検索結果を取得できませんでした'));
    expect(partialFailureStatus?.textContent).toContain('患者');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /薬剤/ }));
    });

    expect(screen.getByText('アムロジピン錠')).toBeTruthy();
  });
});
