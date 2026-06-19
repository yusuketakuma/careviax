// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock,
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
}));

import { toast } from 'sonner';
import { ConferencesContent } from './conferences-content';

setupDomTestEnv();

describe('ConferencesContent', () => {
  const mutationConfigs: Array<{
    mutationFn?: (payload: object) => Promise<unknown>;
    onSuccess?: (payload: unknown) => void;
  }> = [];
  const mutationMocks: ReturnType<typeof vi.fn>[] = [];
  const queryConfigs: Array<{
    queryKey: unknown[];
    queryFn?: () => Promise<unknown>;
  }> = [];
  const invalidateQueriesMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mutationConfigs.length = 0;
    mutationMocks.length = 0;
    queryConfigs.length = 0;
    useOrgIdMock.mockReturnValue('org_1');
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/conferences');
    useQueryClientMock.mockReturnValue({
      invalidateQueries: invalidateQueriesMock,
    });
    useMutationMock.mockImplementation((config: (typeof mutationConfigs)[number]) => {
      mutationConfigs.push(config);
      const mutate = vi.fn();
      mutationMocks.push(mutate);
      return {
        mutate,
        mutateAsync: vi.fn(),
        isPending: false,
      };
    });
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        const { queryKey } = config;
        queryConfigs.push(config);
        if (queryKey[0] === 'conference-notes' || queryKey[0] === 'conference-notes-calendar') {
          return { data: { data: [] }, isLoading: false };
        }
        if (queryKey[0] === 'community-activities') {
          return { data: { data: [] }, isLoading: false };
        }
        if (queryKey[0] === 'conference-external-professionals') {
          return { data: { data: [] }, isLoading: false };
        }
        if (queryKey[0] === 'conference-prescriber-institution-suggestion') {
          return { data: { data: null }, isLoading: false };
        }
        return { data: undefined, isLoading: false };
      },
    );
  });

  it('shows the home context banner for notes focus', () => {
    render(<ConferencesContent initialFocus="notes" initialContext="dashboard_home" />);

    expect(screen.getByTestId('conferences-context-banner')).toBeTruthy();
    expect(
      screen.getByText('ホームからカンファレンス記録にフォーカスして開いています。'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'カンファレンス記録' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '一覧' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'カレンダー' }).getAttribute('aria-pressed')).toBe(
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: '新規記録' }));

    expect(screen.getByLabelText('登録済み他職種')).toBeTruthy();
    expect(screen.getByLabelText('氏名')).toBeTruthy();
    expect(screen.getByLabelText('役割・所属')).toBeTruthy();
    expect(screen.getByLabelText('メール')).toBeTruthy();
    expect(screen.getByLabelText('FAX')).toBeTruthy();
  });

  it('keeps conference note required validation visible inline', () => {
    render(<ConferencesContent initialFocus="notes" initialContext="dashboard_home" />);

    fireEvent.click(screen.getByRole('button', { name: '新規記録' }));
    fireEvent.click(screen.getByRole('button', { name: '作成' }));

    expect(screen.getByText('タイトルを入力してください').getAttribute('role')).toBe('alert');
    expect(screen.getByText('開催日時を入力してください').getAttribute('role')).toBe('alert');
    expect(screen.getByText('内容または構造化項目を入力してください').getAttribute('role')).toBe(
      'alert',
    );
    expect(screen.getByLabelText('タイトル').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('タイトル').getAttribute('aria-describedby')).toBe(
      'conf-title-error',
    );
    expect(screen.getByLabelText('開催日時').getAttribute('aria-describedby')).toBe(
      'conf-date-error',
    );
    expect(screen.getByLabelText('内容').getAttribute('aria-describedby')).toBe(
      'conf-content-error',
    );
    expect(screen.getByLabelText('会議要約').getAttribute('aria-describedby')).toBe(
      'conf-content-error',
    );
    expect(toast.error).toHaveBeenCalledWith('タイトルを入力してください');
    expect(mutationMocks[0]).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('会議要約'), {
      target: { value: '決定事項を共有した' },
    });

    expect(screen.queryByText('内容または構造化項目を入力してください')).toBeNull();
  });

  it('keeps community activity required validation visible inline', () => {
    render(<ConferencesContent initialFocus="activities" initialContext="dashboard_home" />);

    fireEvent.click(screen.getByRole('button', { name: '活動登録' }));
    fireEvent.click(screen.getByRole('button', { name: '登録' }));

    expect(screen.getByText('活動種別を入力してください').getAttribute('role')).toBe('alert');
    expect(screen.getByText('実施日時を入力してください').getAttribute('role')).toBe('alert');
    expect(screen.getByText('タイトルを入力してください').getAttribute('role')).toBe('alert');
    expect(screen.getByLabelText('活動種別').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('活動種別').getAttribute('aria-describedby')).toBe(
      'activity-type-error',
    );
    expect(screen.getByLabelText('実施日時').getAttribute('aria-describedby')).toBe(
      'activity-date-error',
    );
    expect(screen.getByLabelText('タイトル').getAttribute('aria-describedby')).toBe(
      'activity-title-error',
    );
    expect(toast.error).toHaveBeenCalledWith('活動種別を入力してください');
    expect(mutationMocks[1]).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '活動登録' }));

    expect(screen.queryByText('活動種別を入力してください')).toBeNull();
  });

  it('shows patient-detail context and refreshes patient home operations after creating a note', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('patient_id=patient_1&case_id=case_1'));

    render(<ConferencesContent initialFocus="notes" initialContext="patient_detail" />);

    expect(
      screen.getByText('患者詳細からこの患者のカンファレンス記録にフォーカスして開いています。'),
    ).toBeTruthy();

    act(() => {
      mutationConfigs[0]?.onSuccess?.({
        data: {
          id: 'note_1',
          title: '退院前カンファ',
          case_id: 'case_1',
          patient_id: 'patient_1',
        },
        sync: {},
      });
    });

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['patient-home-operations', 'patient_1', 'org_1'],
    });
  });

  it('requests summary detail level for the conference calendar query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], hasMore: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ConferencesContent initialFocus="notes" initialViewMode="calendar" />);

    expect(screen.getByRole('button', { name: '前月を表示' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '翌月を表示' })).toBeTruthy();

    const calendarConfig = queryConfigs.find(
      (config) => config.queryKey[0] === 'conference-notes-calendar',
    );
    await calendarConfig?.queryFn?.();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/conference-notes?'),
      expect.objectContaining({
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('detail_level=summary');
    expect(calledUrl).toContain('date_from=');
    expect(calledUrl).toContain('date_to=');

    vi.unstubAllGlobals();
  });

  it('requests summary detail level for the conference list query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], hasMore: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ConferencesContent initialFocus="notes" />);

    const listConfig = queryConfigs.find((config) => config.queryKey[0] === 'conference-notes');
    await listConfig?.queryFn?.();

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/conference-notes?');
    expect(calledUrl).toContain('detail_level=summary');

    vi.unstubAllGlobals();
  });

  it('renders summary notes first and shows full detail after selecting a note', () => {
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        const { queryKey } = config;
        queryConfigs.push(config);
        if (queryKey[0] === 'conference-notes') {
          return {
            data: {
              data: [
                {
                  id: 'note_1',
                  note_type: 'service_manager',
                  title: '担当者会議',
                  content: '',
                  participants: [{ name: '佐藤CM', role: 'care_manager' }],
                  conference_date: '2026-03-30T10:00:00.000Z',
                  action_items: null,
                  case_id: 'case_1',
                  patient_id: 'patient_1',
                  sync_summary: {
                    report_draft_ids: ['report_1'],
                    tasks_created: 1,
                  },
                  generated_report_id: null,
                  created_at: '2026-03-30T11:00:00.000Z',
                },
              ],
            },
            isLoading: false,
          };
        }
        if (queryKey[0] === 'conference-note-detail' && queryKey[2] === 'note_1') {
          return {
            data: {
              id: 'note_1',
              note_type: 'service_manager',
              title: '担当者会議',
              content: '会議目的: 訪問頻度の見直し',
              participants: [{ name: '佐藤CM', role: 'care_manager' }],
              conference_date: '2026-03-30T10:00:00.000Z',
              action_items: [{ title: 'サービス調整を反映', assignee: '薬剤師' }],
              case_id: 'case_1',
              patient_id: 'patient_1',
              sync_summary: {
                report_draft_ids: ['report_1'],
                tasks_created: 1,
              },
              generated_report_id: null,
              created_at: '2026-03-30T11:00:00.000Z',
            },
            isLoading: false,
          };
        }
        if (queryKey[0] === 'conference-notes-calendar') {
          return { data: { data: [] }, isLoading: false };
        }
        if (queryKey[0] === 'community-activities') {
          return { data: { data: [] }, isLoading: false };
        }
        if (queryKey[0] === 'conference-external-professionals') {
          return { data: { data: [] }, isLoading: false };
        }
        if (queryKey[0] === 'conference-prescriber-institution-suggestion') {
          return { data: { data: null }, isLoading: false };
        }
        return { data: undefined, isLoading: false };
      },
    );

    render(<ConferencesContent initialFocus="notes" />);

    expect(screen.getAllByText('担当者会議').length).toBeGreaterThan(0);
    expect(screen.queryByText('会議目的: 訪問頻度の見直し')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '詳細を開く' }));

    expect(screen.getByText('会議目的: 訪問頻度の見直し')).toBeTruthy();
    expect(screen.getByText('サービス調整を反映')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ドラフト1' }).getAttribute('href')).toBe(
      '/reports/report_1',
    );

    fireEvent.click(screen.getByRole('button', { name: '報告書を生成' }));

    expect(screen.getByLabelText('報告書種別')).toBeTruthy();
  });
});
