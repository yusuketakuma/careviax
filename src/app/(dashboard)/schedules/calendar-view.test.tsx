// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';

// useMonthSchedules は useRealtimeQuery 経由。これをモックして取得状態(error/empty)を制御する。
const { realtimeQueryMock, refetchMock, orgIdMock } = vi.hoisted(() => ({
  realtimeQueryMock: vi.fn(),
  refetchMock: vi.fn(),
  orgIdMock: vi.fn(() => 'org_1'),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: orgIdMock }));
vi.mock('@/lib/hooks/use-realtime-query', () => ({ useRealtimeQuery: realtimeQueryMock }));

import { CalendarView } from './calendar-view';

function renderCalendar() {
  return render(<CalendarView />, { wrapper: createQueryClientWrapper() });
}

// カレンダーの日セルは aria-label="M月d日(件数)" を持つ。月ナビ(前月/翌月/今月)は「日」を含まない。
const DAY_CELL_NAME = /月.+日/;

function currentDateKey() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

describe('CalendarView false-empty', () => {
  beforeEach(() => {
    realtimeQueryMock.mockReset();
    refetchMock.mockReset();
    orgIdMock.mockReturnValue('org_1');
    vi.unstubAllGlobals();
  });

  it('renders a retryable segment error — not an empty calendar — when the schedule fetch fails', () => {
    realtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('raw backend error includes patient=山田 太郎 storage_key=secret'),
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    expect(screen.getByText('スケジュールを取得できませんでした')).toBeTruthy();
    expect(document.body.textContent).not.toContain('raw backend error');
    expect(document.body.textContent).not.toContain('storage_key=secret');
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    // teeth: 取得失敗が「予定ゼロの空カレンダー」に化けない（日セルを描画しない）。
    expect(screen.queryAllByRole('button', { name: DAY_CELL_NAME })).toHaveLength(0);
  });

  it('renders the calendar grid (not an error) on a successful but empty month', () => {
    realtimeQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    // 取得成功・0件は ErrorState を出さず、通常の空カレンダー(日セル)を描画する。
    expect(screen.queryByText('スケジュールを取得できませんでした')).toBeNull();
    expect(screen.getAllByRole('button', { name: DAY_CELL_NAME }).length).toBeGreaterThan(0);
  });

  it('does not render an error or grid while loading', () => {
    realtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    expect(screen.getByRole('status', { name: 'スケジュールを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('スケジュールを取得できませんでした')).toBeNull();
    expect(screen.queryAllByRole('button', { name: DAY_CELL_NAME })).toHaveLength(0);
  });

  it('keeps showing loading (not an error) while the org is still bootstrapping', () => {
    // orgId 未確定(bootstrap 中)は isError=true でも error にせず loading 扱い。
    orgIdMock.mockReturnValue('');
    realtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    expect(screen.getByRole('status', { name: 'スケジュールを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('スケジュールを取得できませんでした')).toBeNull();
  });

  it('refetches when the reload button is clicked', () => {
    realtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('warns when the billing preview fetch fails so cadence warnings are not silently dropped', async () => {
    // 主スケジュールは成功・非空(プレビュー要求が立つ)。算定プレビュー(別 query)だけ失敗させ、
    // 請求サイクル警告の根拠欠落を黙らず明示することを確認する。
    realtimeQueryMock.mockReturnValue({
      data: [
        {
          id: 'sch_1',
          scheduled_date: '2026-06-15',
          schedule_status: 'planned',
          visit_type: 'home',
          pharmacist_id: 'ph_1',
          case_id: 'case_1',
          cycle_id: null,
          case_: { patient: { id: 'p1', name: '患者 太郎' } },
        },
      ],
      isLoading: false,
      isError: false,
      refetch: refetchMock,
      connected: true,
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('billing-preview-batch')) {
        return Promise.resolve(new Response(JSON.stringify({}), { status: 500 }));
      }
      return Promise.resolve(Response.json({ data: {} }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCalendar();

    expect(await screen.findByText('算定プレビューを読み込めませんでした')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('shows patient operational summary chips in the selected day panel', () => {
    const todayKey = currentDateKey();
    realtimeQueryMock.mockReturnValue({
      data: [
        {
          id: 'sch_1',
          scheduled_date: todayKey,
          schedule_status: 'planned',
          visit_type: 'regular',
          pharmacist_id: 'ph_1',
          case_id: 'case_1',
          cycle_id: null,
          time_window_start: '1970-01-01T09:00:00.000Z',
          time_window_end: '1970-01-01T10:00:00.000Z',
          case_: { patient: { id: 'p1', name: '患者 太郎' } },
          patient_summary: {
            patient_id: 'p1',
            name: '患者 太郎',
            archive: {
              status: 'archived',
              archived: true,
              archived_at: '2026-06-01T00:00:00.000Z',
            },
            insurance: {
              current: [],
              current_count: 0,
              missing: true,
              expires_soon_count: 0,
            },
            safety: {
              has_allergy: true,
              allergy_label: 'アレルギーあり',
              critical_lab_count: 1,
              stale_lab_count: 0,
              lab_flags: [],
            },
          },
        },
      ],
      isLoading: false,
      isError: false,
      refetch: refetchMock,
      connected: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ data: {} }),
        } as Response),
      ),
    );

    renderCalendar();

    const today = new Date();
    fireEvent.click(
      screen.getByRole('button', {
        name: `${today.getMonth() + 1}月${today.getDate()}日 1件`,
      }),
    );

    expect(screen.getByText('アーカイブ中')).toBeTruthy();
    expect(screen.getByText('アレルギー')).toBeTruthy();
    expect(screen.getByText('検査値要確認')).toBeTruthy();
    expect(screen.getByText('保険未確認')).toBeTruthy();
  });
});

describe('CalendarView status badge', () => {
  beforeEach(() => {
    realtimeQueryMock.mockReset();
    refetchMock.mockReset();
    orgIdMock.mockReturnValue('org_1');
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ data: {} }) } as Response)),
    );
  });

  function renderWithStatus(status: string) {
    realtimeQueryMock.mockReturnValue({
      data: [
        {
          id: 'sch_status',
          scheduled_date: currentDateKey(),
          schedule_status: status,
          visit_type: 'regular',
          pharmacist_id: 'ph_1',
          case_id: 'case_1',
          cycle_id: null,
          case_: { patient: { id: 'p1', name: '患者 太郎' } },
        },
      ],
      isLoading: false,
      isError: false,
      refetch: refetchMock,
      connected: true,
    });
    renderCalendar();
  }

  it('renders no_show as 不在 with the blocked (red) role — matching the board, not neutral gray', () => {
    renderWithStatus('no_show');
    const badge = screen.getByText('不在');
    expect(badge.className).toContain('text-state-blocked');
    // teeth: 停止状態(不在)を良性の readonly 灰に化けさせない。
    expect(badge.className).not.toContain('text-state-readonly');
    // teeth: 生 enum 文字列を利用者に露出しない(§11)。
    expect(document.body.textContent).not.toContain('no_show');
  });

  it('renders rescheduled as 再調整 with the confirm (orange) role', () => {
    renderWithStatus('rescheduled');
    const badge = screen.getByText('再調整');
    expect(badge.className).toContain('text-state-confirm');
    expect(document.body.textContent).not.toContain('rescheduled');
  });

  it('shows 状態未設定 — never the raw enum — for an unknown status value', () => {
    renderWithStatus('totally_unknown');
    expect(screen.getByText('状態未設定')).toBeTruthy();
    // teeth: 想定外の enum 外値でも生文字列を出さない。
    expect(document.body.textContent).not.toContain('totally_unknown');
  });
});
