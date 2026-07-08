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
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildReportHref } from '@/lib/reports/navigation';
import { jsonResponse } from '@/test/fetch-test-utils';
import { ConferencesContent } from './conferences-content';

setupDomTestEnv();

describe('ConferencesContent', () => {
  type ConferenceNoteTestFixture = {
    id: string;
    note_type: string;
    title: string;
    content: string;
    participants: Array<{ name: string; role: string }>;
    conference_date: string;
    action_items: Array<{ title: string; assignee?: string; converted_task_id?: string }> | null;
    case_id: string | null;
    patient_id?: string | null;
    sync_summary?: {
      report_draft_ids?: string[];
      billing_candidate_id?: string | null;
      visit_proposal_id?: string | null;
      tasks_created?: number;
      medication_issues_created?: number;
    } | null;
    generated_report_id?: string | null;
    created_at: string;
  };

  const mutationConfigs: Array<{
    mutationFn?: (payload: Record<string, unknown>) => Promise<unknown>;
    onSuccess?: (payload: unknown) => void | Promise<void>;
    onError?: (error: unknown) => void;
  }> = [];
  const mutationMocks: ReturnType<typeof vi.fn>[] = [];
  const queryConfigs: Array<{
    queryKey: unknown[];
    queryFn?: () => Promise<unknown>;
  }> = [];
  const invalidateQueriesMock = vi.fn();

  function makeConferenceNote(
    overrides: Partial<ConferenceNoteTestFixture> = {},
  ): ConferenceNoteTestFixture {
    return {
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
      ...overrides,
    };
  }

  function mockConferenceNoteQueries(summaryNote: ConferenceNoteTestFixture) {
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        const { queryKey } = config;
        queryConfigs.push(config);
        if (queryKey[0] === 'conference-notes') {
          return {
            data: {
              data: [summaryNote],
            },
            isLoading: false,
          };
        }
        if (queryKey[0] === 'conference-note-detail' && queryKey[2] === summaryNote.id) {
          return {
            data: summaryNote,
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
  }

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

    fireEvent.click(screen.getByRole('button', { name: '参加者を追加' }));
    const deleteButton = screen.getByRole('button', { name: '参加者2件目を削除' });
    expect(deleteButton.getAttribute('aria-label')).not.toMatch(/佐藤|山田|patient/);
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
        headers: buildOrgHeaders('org_1'),
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

  it('reads community activities through the current data/meta cursor page shape', async () => {
    const activity = {
      id: 'activity_1',
      activity_type: 'seminar',
      title: '地域向け勉強会',
      description: null,
      partner_name: null,
      activity_date: '2026-03-29T09:00:00.000Z',
      target_population: null,
      attendee_count: null,
      referrals_generated: null,
      follow_up_required: false,
      outcome_summary: null,
      created_at: '2026-03-29T09:30:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [activity],
        meta: {
          has_more: false,
          next_cursor: null,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ConferencesContent initialFocus="activities" />);

    const activitiesConfig = queryConfigs.find(
      (config) => config.queryKey[0] === 'community-activities',
    );
    await expect(activitiesConfig?.queryFn?.()).resolves.toEqual({
      data: [activity],
      hasMore: false,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/community-activities?limit=100', {
      headers: buildOrgHeaders('org_1'),
    });

    vi.unstubAllGlobals();
  });

  it('encodes report, proposal, and PDF browser hrefs for hostile note identities', async () => {
    const hostileNoteId = 'note/id?download=1#frag';
    const hostileReportId = 'report/id?tab=summary#draft';
    const hostileCaseId = 'case/id?x=1#frag';
    const hostilePatientId = 'patient/id?y=2#frag';
    const note = makeConferenceNote({
      id: hostileNoteId,
      case_id: hostileCaseId,
      patient_id: hostilePatientId,
      sync_summary: {
        report_draft_ids: [hostileReportId],
        visit_proposal_id: 'proposal_1',
        tasks_created: 1,
      },
    });
    mockConferenceNoteQueries(note);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: note }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ConferencesContent initialFocus="notes" />);
    fireEvent.click(screen.getByRole('button', { name: '詳細を開く' }));

    const detailConfig = queryConfigs.find(
      (config) =>
        config.queryKey[0] === 'conference-note-detail' && config.queryKey[2] === hostileNoteId,
    );
    expect(detailConfig?.queryKey).toEqual(['conference-note-detail', 'org_1', hostileNoteId]);
    await detailConfig?.queryFn?.();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conference-notes/note%2Fid%3Fdownload%3D1%23frag',
      {
        headers: buildOrgHeaders('org_1'),
      },
    );
    expect(screen.getByRole('link', { name: 'ドラフト1' }).getAttribute('href')).toBe(
      buildReportHref(hostileReportId),
    );
    expect(screen.getByRole('link', { name: '報告書を確認' }).getAttribute('href')).toBe(
      buildReportHref(hostileReportId),
    );
    const proposalParams = new URLSearchParams({
      case_id: hostileCaseId,
      patient_id: hostilePatientId,
      focus: 'patient',
    });
    expect(screen.getByRole('link', { name: '訪問候補を確認' }).getAttribute('href')).toBe(
      `/schedules/proposals?${proposalParams.toString()}`,
    );

    const pdfHref = screen.getByRole('link', { name: 'PDF' }).getAttribute('href');
    expect(pdfHref).toBe('/api/conference-notes/note%2Fid%3Fdownload%3D1%23frag/pdf');
    expect(pdfHref).not.toContain('?download');
    expect(pdfHref).not.toContain('#frag');
    expect(pdfHref).not.toContain('%25');

    vi.unstubAllGlobals();
  });

  it('keeps read query server error messages for conference support data', async () => {
    const hostileNoteId = 'note/id?download=1#frag';
    const contextParams = new URLSearchParams({
      patient_id: 'patient_1',
      case_id: 'case_1',
    });
    useSearchParamsMock.mockReturnValue(contextParams);
    mockConferenceNoteQueries(makeConferenceNote({ id: hostileNoteId }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/conference-notes/note%2Fid%3Fdownload%3D1%23frag') {
        return jsonResponse({ message: '詳細を表示できません' }, 403);
      }
      if (url === '/api/admin/external-professionals') {
        return jsonResponse({ message: '他職種を表示できません' }, 403);
      }
      if (url === '/api/prescriber-institutions/suggestion?patient_id=patient_1&case_id=case_1') {
        return jsonResponse({ message: '処方元候補を表示できません' }, 403);
      }
      return jsonResponse({ message: `unexpected fetch: ${url}` }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ConferencesContent initialFocus="notes" />);
    fireEvent.click(screen.getByRole('button', { name: '詳細を開く' }));

    const detailConfig = queryConfigs.find(
      (config) =>
        config.queryKey[0] === 'conference-note-detail' && config.queryKey[2] === hostileNoteId,
    );
    const externalProfessionalsConfig = queryConfigs.find(
      (config) => config.queryKey[0] === 'conference-external-professionals',
    );
    const prescriberSuggestionConfig = queryConfigs.find(
      (config) => config.queryKey[0] === 'conference-prescriber-institution-suggestion',
    );

    await expect(detailConfig?.queryFn?.()).rejects.toThrow('詳細を表示できません');
    await expect(externalProfessionalsConfig?.queryFn?.()).rejects.toThrow(
      '他職種を表示できません',
    );
    await expect(prescriberSuggestionConfig?.queryFn?.()).rejects.toThrow(
      '処方元候補を表示できません',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conference-notes/note%2Fid%3Fdownload%3D1%23frag',
      {
        headers: buildOrgHeaders('org_1'),
      },
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/external-professionals', {
      headers: buildOrgHeaders('org_1'),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/prescriber-institutions/suggestion?patient_id=patient_1&case_id=case_1',
      {
        headers: buildOrgHeaders('org_1'),
      },
    );

    vi.unstubAllGlobals();
  });

  it('encodes save-summary report and proposal hrefs without encoding raw summary state', () => {
    const hostileReportId = 'report/id?tab=summary#draft';
    const hostileCaseId = 'case/id?x=1#frag';
    const hostilePatientId = 'patient/id?y=2#frag';
    const contextParams = new URLSearchParams({
      case_id: hostileCaseId,
      patient_id: hostilePatientId,
    });
    useSearchParamsMock.mockReturnValue(contextParams);

    render(<ConferencesContent initialFocus="notes" />);

    act(() => {
      mutationConfigs[0]?.onSuccess?.({
        data: {
          id: 'note_1',
          title: '退院前カンファ',
          case_id: hostileCaseId,
          patient_id: hostilePatientId,
        },
        sync: {
          report_draft_ids: [hostileReportId],
          visit_proposal_id: 'proposal_1',
        },
      });
    });

    expect(screen.getByRole('link', { name: 'ドラフト1' }).getAttribute('href')).toBe(
      buildReportHref(hostileReportId),
    );
    expect(screen.getByRole('link', { name: '報告書を確認' }).getAttribute('href')).toBe(
      buildReportHref(hostileReportId),
    );
    const proposalParams = new URLSearchParams({
      case_id: hostileCaseId,
      patient_id: hostilePatientId,
      focus: 'patient',
    });
    expect(screen.getByRole('link', { name: '訪問候補を確認' }).getAttribute('href')).toBe(
      `/schedules/proposals?${proposalParams.toString()}`,
    );
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['patient-home-operations', hostilePatientId, 'org_1'],
    });
  });

  it('uses shared JSON headers and encoded dynamic paths for conference note mutations', async () => {
    const hostileNoteId = 'note/id?task=1#frag';
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { report_draft_count: 1, queued_recipient_count: 0 } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ConferencesContent initialFocus="notes" />);

    await mutationConfigs[2]?.mutationFn?.({
      noteId: hostileNoteId,
      actionItemIndex: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conference-notes/note%2Fid%3Ftask%3D1%23frag/tasks',
      {
        method: 'POST',
        headers: buildOrgJsonHeaders('org_1'),
        body: JSON.stringify({ action_item_index: 2 }),
      },
    );

    await mutationConfigs[3]?.mutationFn?.({
      note: makeConferenceNote({ id: hostileNoteId }),
      reportType: 'care_manager_report',
      autoSend: true,
      includeStructuredContent: false,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/conference-notes/note%2Fid%3Ftask%3D1%23frag/generate-report',
      {
        method: 'POST',
        headers: buildOrgJsonHeaders('org_1'),
        body: JSON.stringify({
          report_type: 'care_manager_report',
          auto_send: true,
          include_structured_content: false,
        }),
      },
    );

    vi.unstubAllGlobals();
  });

  it('keeps conference mutation server error messages', () => {
    render(<ConferencesContent initialFocus="notes" />);

    mutationConfigs[2]?.onError?.(new Error('既にタスク化されています'));
    mutationConfigs[3]?.onError?.(new Error('報告書種別が無効です'));

    expect(toast.error).toHaveBeenCalledWith('既にタスク化されています');
    expect(toast.error).toHaveBeenCalledWith('報告書種別が無効です');
  });

  it('keeps conference mutation server error messages from API responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: '既にタスク化されています' }, 409),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ConferencesContent initialFocus="notes" />);

    await expect(
      mutationConfigs[2]?.mutationFn?.({ noteId: 'note_1', actionItemIndex: 0 }),
    ).rejects.toThrow('既にタスク化されています');

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '報告書種別が無効です' }, 400));
    await expect(
      mutationConfigs[3]?.mutationFn?.({
        note: makeConferenceNote({ id: 'note_1' }),
        reportType: 'unsupported',
        autoSend: false,
        includeStructuredContent: true,
      }),
    ).rejects.toThrow('報告書種別が無効です');

    vi.unstubAllGlobals();
  });

  it('falls back to operation-specific conference mutation messages', () => {
    render(<ConferencesContent initialFocus="notes" />);

    mutationConfigs[2]?.onError?.({});
    mutationConfigs[3]?.onError?.({});

    expect(toast.error).toHaveBeenCalledWith('タスク化に失敗しました');
    expect(toast.error).toHaveBeenCalledWith('報告書生成に失敗しました');
  });

  it('uses the clicked action item index when duplicate titles and assignees exist', () => {
    mockConferenceNoteQueries(
      makeConferenceNote({
        action_items: [
          {
            title: '医師へ共有',
            assignee: '管理者',
            converted_task_id: 'task_existing',
          },
          {
            title: '医師へ共有',
            assignee: '管理者',
          },
        ],
      }),
    );

    render(<ConferencesContent initialFocus="notes" />);
    fireEvent.click(screen.getByRole('button', { name: '詳細を開く' }));

    fireEvent.click(screen.getByRole('button', { name: 'タスク化' }));

    expect(
      mutationMocks.flatMap((mock) => mock.mock.calls.map(([payload]) => payload)),
    ).toContainEqual({
      noteId: 'note_1',
      actionItemIndex: 1,
    });
  });

  it('rejects dot-segment conference note ids before fetch for dynamic note paths', async () => {
    const dotNote = makeConferenceNote({ id: '.' });
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        const { queryKey } = config;
        queryConfigs.push(config);
        if (queryKey[0] === 'conference-notes') {
          return {
            data: {
              data: [dotNote],
            },
            isLoading: false,
          };
        }
        if (queryKey[0] === 'conference-note-detail' && queryKey[2] === dotNote.id) {
          return { data: undefined, isLoading: false };
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
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ConferencesContent initialFocus="notes" />);
    fireEvent.click(screen.getByRole('button', { name: '詳細を開く' }));

    const detailConfig = queryConfigs.find(
      (config) => config.queryKey[0] === 'conference-note-detail' && config.queryKey[2] === '.',
    );
    await expect(detailConfig?.queryFn?.()).rejects.toThrow(RangeError);
    await expect(detailConfig?.queryFn?.()).rejects.toThrow('Path segment cannot be a dot segment');
    await expect(
      mutationConfigs[2]?.mutationFn?.({ noteId: '..', actionItemIndex: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      mutationConfigs[3]?.mutationFn?.({
        note: makeConferenceNote({ id: '.' }),
        reportType: 'internal_record',
        autoSend: false,
        includeStructuredContent: true,
      }),
    ).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();

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

  it('shows an error state with retry instead of a false empty state when conference notes fail to load', () => {
    const notesRefetchMock = vi.fn();
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        const { queryKey } = config;
        queryConfigs.push(config);
        if (queryKey[0] === 'conference-notes') {
          return {
            data: undefined,
            isLoading: false,
            isError: true,
            refetch: notesRefetchMock,
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

    expect(screen.queryByText('カンファレンス記録はまだありません')).toBeNull();
    expect(screen.getByText('カンファレンス記録を取得できませんでした')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(notesRefetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows an error state with retry instead of a false empty calendar when calendar notes fail to load', () => {
    const calendarRefetchMock = vi.fn();
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        const { queryKey } = config;
        queryConfigs.push(config);
        if (queryKey[0] === 'conference-notes') {
          return { data: { data: [] }, isLoading: false };
        }
        if (queryKey[0] === 'conference-notes-calendar') {
          return {
            data: undefined,
            isLoading: false,
            isError: true,
            refetch: calendarRefetchMock,
          };
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

    render(<ConferencesContent initialFocus="notes" initialViewMode="calendar" />);

    expect(screen.getByText('カレンダーを取得できませんでした')).toBeTruthy();
    expect(screen.queryByText('月')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(calendarRefetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows an error state with retry instead of a false empty state when community activities fail to load', () => {
    const activitiesRefetchMock = vi.fn();
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn?: () => Promise<unknown> }) => {
        const { queryKey } = config;
        queryConfigs.push(config);
        if (queryKey[0] === 'conference-notes' || queryKey[0] === 'conference-notes-calendar') {
          return { data: { data: [] }, isLoading: false };
        }
        if (queryKey[0] === 'community-activities') {
          return {
            data: undefined,
            isLoading: false,
            isError: true,
            refetch: activitiesRefetchMock,
          };
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

    render(<ConferencesContent initialFocus="activities" />);

    expect(screen.queryByText('地域活動はまだありません')).toBeNull();
    expect(screen.getByText('地域活動を取得できませんでした')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(activitiesRefetchMock).toHaveBeenCalledTimes(1);
  });
});
