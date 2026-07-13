// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  buildCommunicationRequestApiPath,
  buildCommunicationRequestsApiPath,
} from '@/lib/communications/api-paths';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildTasksApiPath } from '@/lib/tasks/api-paths';
import {
  PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
  PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
  type PatientArchiveSummary,
} from '@/lib/patient/archive-summary';
import { InterprofessionalShareContent } from './interprofessional-share-content';

setupDomTestEnv();

const clientLogWarnMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn(() => 'org_1'));

const REPORT_UPDATED_AT_ISO = '2026-06-18T01:02:03.000Z';

type ReportFixture = {
  id: string;
  patient_id: string;
  case_id: string | null;
  report_type: string;
  updated_at: string;
  status: string;
  pdf_url: string | null;
  patient_summary: {
    id: string;
    name: string | null;
    archive: PatientArchiveSummary;
  } | null;
  permissions: {
    can_edit: boolean;
    can_send: boolean;
    can_create_external_share: boolean;
    can_create_followup_task: boolean;
    can_view_patient: boolean;
    can_view_related_requests: boolean;
  };
  content?: Record<string, unknown>;
};

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/utils/client-log', () => ({
  clientLog: { warn: clientLogWarnMock },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

vi.mock('@/lib/communications/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/communications/api-paths')>();
  return {
    ...actual,
    buildCommunicationRequestApiPath: vi.fn(actual.buildCommunicationRequestApiPath),
    buildCommunicationRequestsApiPath: vi.fn(actual.buildCommunicationRequestsApiPath),
  };
});

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

// Actual-backed spy: real encode/guard output for the hostile-id test, plus
// return-value delegation teeth for both patient Link hrefs.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

vi.mock('@/lib/reports/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/reports/navigation')>();
  return { ...actual, buildReportHref: vi.fn(actual.buildReportHref) };
});

vi.mock('@/lib/tasks/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/tasks/api-paths')>();
  return { ...actual, buildTasksApiPath: vi.fn(actual.buildTasksApiPath) };
});

const REPORT = {
  id: 'rep_1',
  patient_id: 'pt_1',
  case_id: 'case_1',
  report_type: 'care_manager_report',
  updated_at: REPORT_UPDATED_AT_ISO,
  status: 'sent',
  pdf_url: null,
  patient_summary: {
    id: 'pt_1',
    name: '加藤 ミサ',
    archive: {
      status: 'active',
      archived: false,
      archived_at: null,
    } as PatientArchiveSummary,
  },
  permissions: {
    can_edit: true,
    can_send: true,
    can_create_external_share: true,
    can_create_followup_task: true,
    can_view_patient: true,
    can_view_related_requests: true,
  },
  content: {
    title: 'ケアマネへの服薬状況報告',
    patient: { name: '加藤 ミサ', birth_date: '1941-02-14' },
    care_manager: { name: '中島 桜', organization: 'きたきゅうケアプラン' },
    report_date: '2026-06-10',
    visit_date: '2026-06-10',
    pharmacist_name: '山田 花子',
    medication_management_summary: {
      total_drugs: 6,
      compliance_summary: '朝・夕は服用できています。昼分の飲み忘れが週2回ほどあります。',
      self_management: '一部介助',
      calendar_used: true,
    },
    functional_impact: {
      sleep_impact: '影響なし',
      cognition_impact: '変化なし',
      diet_impact: '食欲やや低下',
      mobility_impact: 'ふらつきなし',
      excretion_impact: '便秘気味',
    },
    residual_status: {
      summary: 'マグミット錠が約10日分残っています。',
      reduction_proposals: [],
    },
    care_service_coordination: {
      medication_assistance: '昼分はヘルパー訪問時の声かけをお願いしたいです。',
      unit_dose_packaging: true,
      calendar_recommendation: true,
      other_items: '',
    },
    next_visit_plan: { followup_items: ['昼分の服薬状況を確認'] },
    warnings: [],
  },
} satisfies ReportFixture;

const CARE_TEAM = [
  {
    id: 'member_physician',
    role: 'physician',
    name: '山本 健',
    organization_name: 'やまもと内科',
    is_primary: true,
  },
  {
    id: 'member_care_manager',
    role: 'care_manager',
    name: '中島 桜',
    organization_name: 'きたきゅうケアプラン',
    is_primary: true,
  },
];

const CONTACTS = [
  {
    id: 'contact_child',
    relation: 'child',
    name: '加藤 直子',
    organization_name: null,
    is_primary: true,
  },
];

const REQUESTS = [
  {
    id: 'req_1',
    patient_id: 'pt_1',
    request_type: 'care_report_reply_request',
    recipient_name: '中島 桜',
    recipient_role: 'care_manager',
    related_entity_type: 'care_report',
    related_entity_id: 'rep_1',
    status: 'responded',
    subject: 'ケアマネへの服薬状況報告(共有)',
    requested_at: '2026-06-10T06:30:00.000Z',
    responses: [
      {
        id: 'res_1',
        responder_name: '中島 桜(ケアマネ)',
        responded_at: '2026-06-12T07:40:00.000Z',
      },
    ],
  },
];

const REQUEST_DETAIL = {
  id: 'req_1',
  patient_id: 'pt_1',
  request_type: 'care_report_reply_request',
  related_entity_type: 'care_report',
  related_entity_id: 'rep_1',
  responses: [
    {
      id: 'res_1',
      responder_name: '中島 桜(ケアマネ)',
      content: 'ヘルパーへ声かけ依頼済み。次回確認をお願いします。',
      responded_at: '2026-06-12T07:40:00.000Z',
    },
  ],
};

function stubFetch(
  options: {
    failCareTeam?: boolean;
    failRequests?: boolean;
    report?: ReportFixture;
    refetchedReport?: ReportFixture;
    reportRefetchPromise?: Promise<Response>;
    reportsById?: Record<string, ReportFixture>;
    requests?: typeof REQUESTS;
    requestPages?: Array<typeof REQUESTS>;
    refetchedRequests?: typeof REQUESTS;
    requestDetail?: typeof REQUEST_DETAIL;
    failRequestPost?: Response;
    requestPostPromise?: Promise<Response>;
    failTaskPost?: Response;
  } = {},
) {
  let communicationRequestListReads = 0;
  let reportReads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/care-reports/')) {
      const requestedReportId = decodeURIComponent(url.split('/').at(-1) ?? '');
      const reportReadIndex = reportReads++;
      if (reportReadIndex > 0 && options.reportRefetchPromise) {
        return options.reportRefetchPromise;
      }
      return new Response(
        JSON.stringify({
          data:
            reportReadIndex > 0 && options.refetchedReport
              ? options.refetchedReport
              : (options.reportsById?.[requestedReportId] ?? options.report ?? REPORT),
        }),
        { status: 200 },
      );
    }
    // match by suffix so a hostile report.patient_id API path still stubs ok
    // (the href behavior, not fetch plumbing, is what these tests exercise).
    if (url.includes('/care-team')) {
      if (options.failCareTeam) {
        return new Response('server error', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          data: CARE_TEAM,
          meta: {
            patient_id: decodeURIComponent(url.split('/')[3] ?? ''),
            case_id: 'case_1',
            cases: [{ id: 'case_1', status: 'active' }],
          },
        }),
        { status: 200 },
      );
    }
    if (url.includes('/contacts')) {
      return new Response(
        JSON.stringify({
          data: CONTACTS,
          meta: {
            patient_id: decodeURIComponent(url.split('/')[3] ?? ''),
            expected_updated_at: REPORT_UPDATED_AT_ISO,
            version_basis: 'patient_updated_at',
          },
        }),
        { status: 200 },
      );
    }
    if (
      url.includes('/api/communication-requests?') ||
      url.includes('/api/communication-requests__sentinel?')
    ) {
      if (options.failRequests) {
        return new Response('server error', { status: 500 });
      }
      const pageCursor = new URL(url, 'http://localhost').searchParams.get('cursor');
      const pageIndex = pageCursor ? Number(pageCursor.replace('cursor_', '')) : 0;
      const requestPages = options.requestPages;
      const requests = requestPages
        ? (requestPages[pageIndex] ?? [])
        : communicationRequestListReads++ > 0
          ? (options.refetchedRequests ?? options.requests ?? REQUESTS)
          : (options.requests ?? REQUESTS);
      const hasMore = Boolean(requestPages && pageIndex < requestPages.length - 1);
      return new Response(
        JSON.stringify({
          data: requests,
          meta: {
            limit: 100,
            has_more: hasMore,
            next_cursor: hasMore ? `cursor_${pageIndex + 1}` : null,
          },
        }),
        { status: 200 },
      );
    }
    if (
      (url === '/api/communication-requests' || url === '/api/communication-requests__sentinel') &&
      init?.method === 'POST'
    ) {
      if (options.requestPostPromise) {
        return options.requestPostPromise;
      }
      if (options.failRequestPost) {
        return options.failRequestPost.clone();
      }
      return new Response(JSON.stringify({ data: { id: 'req_new', status: 'sent' } }), {
        status: 201,
      });
    }
    if (url.startsWith('/api/communication-requests/')) {
      return new Response(JSON.stringify({ data: options.requestDetail ?? REQUEST_DETAIL }), {
        status: 200,
      });
    }
    if ((url === '/api/tasks' || url === '/api/tasks__sentinel') && init?.method === 'POST') {
      if (options.failTaskPost) {
        return options.failTaskPost.clone();
      }
      return new Response(JSON.stringify({ data: { id: 'task_1' } }), { status: 201 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderShare(reportId = 'rep_1') {
  return render(<InterprofessionalShareContent reportId={reportId} />, {
    wrapper: createQueryClientWrapper(),
  });
}

function expectFetchHeaders(
  fetchMock: ReturnType<typeof stubFetch>,
  matcher: (url: string) => boolean,
  expectedHeaders: Record<string, string>,
) {
  const call = fetchMock.mock.calls.find(([input]) => matcher(String(input)));
  expect(call?.[1]?.headers).toEqual(expectedHeaders);
}

function readCommunicationRequestPostBody(fetchMock: ReturnType<typeof stubFetch>) {
  const requestCall = fetchMock.mock.calls.find(
    ([input, init]) => String(input) === '/api/communication-requests' && init?.method === 'POST',
  );
  expect(requestCall).toBeTruthy();
  return JSON.parse(String(requestCall?.[1]?.body)) as {
    patient_id: string;
    case_id?: string;
    request_type: string;
    template_key: string;
    recipient_name: string;
    recipient_role: string;
    related_entity_type: string;
    related_entity_id: string;
    expected_report_updated_at: string;
    context_snapshot: {
      source: string;
      report_id: string;
      report_type: string;
      audience: string;
      recipient_organization_name?: string;
      section_keys: string[];
    };
    status: string;
    subject: string;
    content: string;
  };
}

function readTaskPostBody(fetchMock: ReturnType<typeof stubFetch>) {
  const taskCall = fetchMock.mock.calls.find(
    ([input, init]) => String(input) === '/api/tasks' && init?.method === 'POST',
  );
  expect(taskCall).toBeTruthy();
  return JSON.parse(String(taskCall?.[1]?.body)) as {
    task_type: string;
    title: string;
    related_entity_type: string;
    related_entity_id: string;
    dedupe_key: string;
    metadata: {
      report_id: string;
      communication_request_id: string;
    };
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  useOrgIdMock.mockReturnValue('org_1');
});

describe('InterprofessionalShareContent', () => {
  it('shows a share workspace skeleton instead of a generic spinner while loading', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    renderShare();

    expect(
      screen.getByRole('status', { name: '他職種共有ワークスペースを読み込み中' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('読み込み中...', { selector: 'span' })).toBeNull();
    expect(screen.queryByTestId('interprofessional-share')).toBeNull();
    expect(screen.queryByText(REPORT.patient_summary.name as string)).toBeNull();
    expect(screen.queryByText('ケアマネへの服薬状況報告')).toBeNull();
    expect(screen.queryByRole('button', { name: '返信依頼を起票' })).toBeNull();
  });

  it('3 カラム(共有する相手 / 相手に見える内容 / 返信・確認)を描画する', async () => {
    stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-audience-column')).toBeTruthy();
    });

    // 左: 相手 5 区分。報告書タイプ(ケアマネ向け)からケアマネが選択中
    const cards = screen.getAllByTestId('share-audience-card');
    expect(cards).toHaveLength(5);
    expect(cards.map((card) => card.getAttribute('data-audience'))).toEqual([
      'physician',
      'care_manager',
      'visiting_nurse',
      'facility',
      'family',
    ]);
    const selected = cards.find((card) => card.getAttribute('aria-pressed') === 'true');
    expect(selected?.getAttribute('data-audience')).toBe('care_manager');
    await waitFor(() => {
      expect(screen.getByText('中島 桜(きたきゅうケアプラン)')).toBeTruthy();
    });

    // 中央: 5 セクションのプレビュー
    const sections = screen.getAllByTestId('share-preview-section');
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual([
      '服薬状況',
      '残薬',
      '薬剤師からのお願い',
      '次回確認すること',
      '関連資料',
    ]);
    expect(screen.getByText(/昼分の飲み忘れが週2回/)).toBeTruthy();
    expect(screen.getByText('関連資料はありません。')).toBeTruthy();
    expect(screen.queryByText(/訪問報告書PDF/)).toBeNull();

    // 右: ケアマネからの返信と主操作
    expect(screen.getByText('ケアマネからの返信')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card').textContent).toContain(
        'ヘルパーへ声かけ依頼済み',
      );
    });
    expect(screen.getByTestId('share-open-request-link').getAttribute('href')).toBe(
      '/communications/requests?status=responded&request_type=care_report_reply_request&patient_id=pt_1&request_id=req_1&related_entity_type=care_report&related_entity_id=rep_1',
    );
  });

  it('case-less legacy report uses the patient default care case without losing recipient discovery', async () => {
    stubFetch({ report: { ...REPORT, case_id: null }, requests: [] });
    renderShare();

    await waitFor(() => {
      expect(screen.getByText('中島 桜(きたきゅうケアプラン)')).toBeTruthy();
    });
    expect(screen.queryByTestId('share-supporting-data-warning')).toBeNull();
    expect((screen.getByTestId('share-create-request-button') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('keeps archived patient context readable while blocking every new share write', async () => {
    const fetchMock = stubFetch({
      report: {
        ...REPORT,
        patient_summary: {
          ...REPORT.patient_summary,
          archive: {
            status: 'archived',
            archived: true,
            archived_at: '2026-06-30T09:00:00.000Z',
          },
        },
      },
    });
    renderShare();

    expect(await screen.findByText('アーカイブ中')).toBeTruthy();
    expect(screen.getByText('加藤 ミサ 様は閲覧専用の患者正本です。')).toBeTruthy();
    expect(
      screen.getByText(/復元するまで新しい外部共有リンク、返信依頼、次回タスクは作成できません/),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: /外部共有リンクの発行/ })).toBeNull();
    expect(
      (screen.getByRole('button', { name: /外部共有リンクの発行/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: /外部共有リンクの発行/ }).getAttribute('aria-describedby'),
    ).toBe('patient-write-availability-description');
    expect(document.getElementById('patient-write-availability-description')).toBeTruthy();
    expect((screen.getByTestId('share-create-request-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId('share-next-task-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('share-preview-column')).toBeTruthy();
    expect(await screen.findByTestId('share-reply-card')).toBeTruthy();
    expect(screen.getByTestId('share-open-request-link')).toBeTruthy();

    fireEvent.click(screen.getByTestId('share-create-request-button'));
    fireEvent.click(screen.getByTestId('share-next-task-button'));
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          (String(input) === '/api/communication-requests' || String(input) === '/api/tasks') &&
          init?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('keeps the archived-patient lifecycle notice when report sharing is unavailable', async () => {
    stubFetch({
      report: {
        ...REPORT,
        status: 'draft',
        patient_summary: {
          ...REPORT.patient_summary,
          archive: {
            status: 'archived',
            archived: true,
            archived_at: '2026-06-30T09:00:00.000Z',
          },
        },
      },
    });
    renderShare();

    expect(await screen.findByTestId('share-permission-warning')).toBeTruthy();
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      'アーカイブ中',
    );
    expect(screen.getByText(/下書きの報告書は外部共有できません/)).toBeTruthy();
    expect(screen.queryByTestId('share-preview-column')).toBeNull();
  });

  it('uses the org header on every share GET request', async () => {
    const fetchMock = stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card')).toBeTruthy();
    });

    const orgHeader = buildOrgHeaders('org_1');
    expectFetchHeaders(fetchMock, (url) => url.startsWith('/api/care-reports/'), orgHeader);
    expect(
      fetchMock.mock.calls.find(([input]) => String(input).startsWith('/api/care-reports/'))?.[1],
    ).toMatchObject({ cache: 'no-store' });
    expectFetchHeaders(fetchMock, (url) => url.includes('/care-team'), orgHeader);
    expectFetchHeaders(fetchMock, (url) => url.includes('/contacts'), orgHeader);
    expectFetchHeaders(
      fetchMock,
      (url) => url.startsWith('/api/communication-requests?'),
      orgHeader,
    );
    expectFetchHeaders(
      fetchMock,
      (url) => url.startsWith('/api/communication-requests/'),
      orgHeader,
    );
    expect(vi.mocked(buildCommunicationRequestsApiPath)).toHaveBeenCalledWith({
      requestType: 'care_report_reply_request',
      relatedEntityType: 'care_report',
      relatedEntityId: 'rep_1',
    });
    expect(vi.mocked(buildCommunicationRequestApiPath)).toHaveBeenCalledWith('req_1');
  });

  it('相手を切り替えると返信パネルが空状態になる(主治医宛て返信なし)', async () => {
    stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5);
    });

    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'physician')!,
    );

    expect(screen.getByText('主治医からの返信')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('share-reply-empty')).toBeTruthy();
    });
    const button = screen.getByTestId('share-next-task-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('2ページ目の対象audience requestを取得してfalse-emptyと重複起票を防ぐ', async () => {
    const physicianRequest = {
      ...REQUESTS[0],
      id: 'req_physician_page_2',
      recipient_name: '山本 健',
      recipient_role: 'physician',
      status: 'sent',
      requested_at: '2026-06-09T06:30:00.000Z',
      responses: [],
    };
    const fetchMock = stubFetch({ requestPages: [REQUESTS, [physicianRequest]] });
    renderShare();

    await waitFor(() => expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5));
    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'physician')!,
    );

    await waitFor(() => {
      expect(screen.getByTestId('share-create-request-button').textContent).toContain(
        '返信依頼起票済み',
      );
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('cursor=cursor_1'))).toBe(
      true,
    );
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === '/api/communication-requests' && init?.method === 'POST',
      ),
    ).toBe(false);
  });

  it.each(['closed', 'cancelled', 'expired'] as const)(
    'terminal request status %s does not block a new reply request',
    async (status) => {
      stubFetch({ requests: [{ ...REQUESTS[0], status, responses: [] }] });
      renderShare();

      const button = await screen.findByTestId('share-create-request-button');
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
      expect(button.textContent).toContain('返信依頼を起票');
      expect(button.textContent).not.toContain('返信依頼起票済み');
    },
  );

  it('報告書取得失敗時は見つからない扱いにせず再読み込み可能なエラー状態を表示する', async () => {
    const fetchMock = vi.fn(async () => new Response('server error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    renderShare();

    await waitFor(() => {
      expect(screen.getByText('報告書を取得できませんでした')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    expect(screen.queryByText('報告書が見つかりません')).toBeNull();
  });

  it('補助情報の部分失敗は共有ページを落とさず警告として表示する', async () => {
    stubFetch({ failCareTeam: true });
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-supporting-data-warning')).toBeTruthy();
    });
    expect(screen.getByText('一部の共有情報を取得できませんでした')).toBeTruthy();
    expect(screen.getByText(/ケアチームを取得できないため/)).toBeTruthy();
    expect(screen.getByTestId('share-preview-column')).toBeTruthy();
  });

  it('「次回タスクにする」で POST /api/tasks に重複防止キーつきで起票する', async () => {
    const fetchMock = stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card')).toBeTruthy();
    });

    const button = screen.getByTestId('share-next-task-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('次回タスク作成済み')).toBeTruthy();
    });

    const taskCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/tasks' && init?.method === 'POST',
    );
    expect(taskCall).toBeTruthy();
    expect(taskCall?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    expect(vi.mocked(buildTasksApiPath)).toHaveBeenCalledWith();
    const body = readTaskPostBody(fetchMock);
    expect(body.task_type).toBe('report_response_followup');
    expect(body.dedupe_key).toBe('share-reply-task:res_1');
    expect(body.related_entity_type).toBe('patient');
    expect(body.related_entity_id).toBe('pt_1');
    expect(body.title).toContain('ケアマネからの返信');

    // 起票済みの返信では再実行できない
    expect((screen.getByTestId('share-next-task-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('選択した相手に POST /api/communication-requests で返信依頼を起票する', async () => {
    const fetchMock = stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5);
    });

    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'physician')!,
    );

    const button = await screen.findByTestId('share-create-request-button');
    await waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('返信依頼起票済み')).toBeTruthy();
    });

    const requestCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/communication-requests' && init?.method === 'POST',
    );
    expect(requestCall?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    expect(vi.mocked(buildCommunicationRequestsApiPath)).toHaveBeenCalledWith();
    const body = readCommunicationRequestPostBody(fetchMock);
    expect(body).toMatchObject({
      patient_id: 'pt_1',
      case_id: 'case_1',
      request_type: 'care_report_reply_request',
      template_key: 'interprofessional_share_reply_request',
      recipient_name: '山本 健',
      recipient_role: 'physician',
      related_entity_type: 'care_report',
      related_entity_id: 'rep_1',
      expected_report_updated_at: REPORT_UPDATED_AT_ISO,
      status: 'sent',
      subject: '返信依頼: 主治医向け報告書共有(加藤 ミサ 様)',
      context_snapshot: {
        source: 'interprofessional_share',
        report_id: 'rep_1',
        report_type: 'care_manager_report',
        audience: 'physician',
        recipient_organization_name: 'やまもと内科',
      },
    });
    expect(body.context_snapshot.section_keys).toEqual([
      'medication_status',
      'residual',
      'pharmacist_request',
      'next_check',
      'attachments',
    ]);
    expect(body.content).toContain('主治医向けに共有する報告内容です');
    expect(body.content).toContain('【薬剤師からのお願い】');
    expect(body.content).toContain('昼分はヘルパー訪問時の声かけ');
    expect(body.content).toContain('【関連資料】\n関連資料はありません。');
    expect(body.content).not.toContain('訪問報告書PDF');
  });

  it('PDF参照が実在するときだけ確定版PDFのavailabilityを表示する', async () => {
    stubFetch({ report: { ...REPORT, pdf_url: '/api/files/file_1/download' } });
    renderShare();

    expect(
      await screen.findByText(
        '訪問報告書PDF（最新の確定版）あり。この返信依頼には自動添付されません。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('関連資料はありません。')).toBeNull();
  });

  it('attributes a pending reply request to the submitted audience after the preview changes', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const requestPostPromise = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    stubFetch({ requestPostPromise });
    renderShare();

    const audienceCard = (key: string) =>
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === key)!;

    await waitFor(() => expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5));
    fireEvent.click(audienceCard('physician'));
    fireEvent.click(await screen.findByTestId('share-create-request-button'));
    fireEvent.click(audienceCard('visiting_nurse'));

    resolveRequest?.(
      new Response(JSON.stringify({ data: { id: 'req_physician_new', status: 'sent' } }), {
        status: 201,
      }),
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('返信依頼を起票しました');
    });

    expect(screen.getByText('訪問看護からの返信')).toBeTruthy();
    expect(screen.getByTestId('share-create-request-button').textContent).toContain(
      '返信依頼を起票',
    );
    expect(screen.getByTestId('share-create-request-button').textContent).not.toContain(
      '返信依頼起票済み',
    );

    fireEvent.click(audienceCard('physician'));
    await waitFor(() => {
      expect(screen.getByTestId('share-create-request-button').textContent).toContain(
        '返信依頼起票済み',
      );
    });
  });

  it('reportまたはorganization切替時に旧共有request stateを同期的に破棄する', async () => {
    const reportTwo = {
      ...REPORT,
      id: 'rep_2',
      patient_id: 'pt_2',
      patient_summary: { ...REPORT.patient_summary, id: 'pt_2', name: '佐藤 花子' },
    };
    stubFetch({
      reportsById: { rep_1: REPORT, rep_2: reportTwo },
      requests: [],
    });
    const view = renderShare('rep_1');

    await waitFor(() => expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5));
    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'physician')!,
    );
    fireEvent.click(await screen.findByTestId('share-create-request-button'));
    await waitFor(() => expect(screen.getByText('返信依頼起票済み')).toBeTruthy());
    expect(screen.getByTestId('share-open-request-link').getAttribute('href')).toContain(
      'request_id=req_new',
    );

    view.rerender(<InterprofessionalShareContent reportId="rep_2" />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: '患者詳細' }).getAttribute('href')).toBe(
        '/patients/pt_2',
      );
    });
    expect(screen.getByTestId('share-create-request-button').textContent).toContain(
      '返信依頼を起票',
    );
    expect(screen.queryByTestId('share-open-request-link')).toBeNull();
    expect(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('aria-pressed') === 'true')
        ?.getAttribute('data-audience'),
    ).toBe('care_manager');

    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'physician')!,
    );
    fireEvent.click(await screen.findByTestId('share-create-request-button'));
    await waitFor(() => expect(screen.getByText('返信依頼起票済み')).toBeTruthy());

    useOrgIdMock.mockReturnValue('org_2');
    view.rerender(<InterprofessionalShareContent reportId="rep_2" />);
    await waitFor(() => {
      expect(screen.getByTestId('share-create-request-button').textContent).toContain(
        '返信依頼を起票',
      );
    });
    expect(screen.queryByTestId('share-open-request-link')).toBeNull();
  });

  it('rejects a legacy-root 2xx reply-request response and leaves retry available', async () => {
    stubFetch({
      failRequestPost: new Response(
        JSON.stringify({
          data: { id: 'req_legacy', status: 'sent' },
          reused_existing_draft: true,
        }),
        { status: 200 },
      ),
    });
    renderShare();

    await waitFor(() => {
      expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5);
    });
    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'physician')!,
    );
    const button = await screen.findByTestId('share-create-request-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        '返信依頼の起票に失敗しました。もう一度お試しください。',
      );
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
    expect(toast.success).not.toHaveBeenCalledWith('返信依頼を起票しました');
    expect(screen.queryByText('返信依頼起票済み')).toBeNull();
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'care_report.interprofessional_share_reply_request_failed',
      expect.any(Error),
      {
        route: '/reports/:id/share',
        entityType: 'care_report_reply_request',
        status: null,
      },
    );
  });

  it('keeps a 409 follow-up task failure PHI-safe and directs duplicate verification', async () => {
    const rawMessage = '患者A 090-1234-5678 token=secret-task-token は既に作成済みです';
    stubFetch({
      failTaskPost: new Response(
        JSON.stringify({ code: 'WORKFLOW_CONFLICT', message: rawMessage }),
        { status: 409 },
      ),
    });
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card')).toBeTruthy();
    });

    const button = screen.getByTestId('share-next-task-button') as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        '次回タスクは既に作成されている可能性があります。タスク一覧を確認してください。',
      );
      expect(button.disabled).toBe(false);
    });
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'care_report.interprofessional_share_followup_task_failed',
      expect.any(Error),
      {
        route: '/reports/:id/share',
        entityType: 'care_report_followup_task',
        status: 409,
      },
    );
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain(rawMessage);
    const [, loggedError] = clientLogWarnMock.mock.calls[0] ?? [];
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).not.toContain(rawMessage);
    expect(screen.getByText('次回タスクの作成状態を確認してください')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '次回タスク作成を再試行' })).toBeNull();
    expect(document.body.textContent).not.toContain(rawMessage);
  });

  it('refreshes patient state and blocks writes when a task POST detects archival', async () => {
    const archivedReport: ReportFixture = {
      ...REPORT,
      patient_summary: {
        ...REPORT.patient_summary,
        archive: {
          status: 'archived',
          archived: true,
          archived_at: '2026-07-13T00:00:00.000Z',
        },
      },
    };
    let resolveReportRefetch!: (response: Response) => void;
    const reportRefetchPromise = new Promise<Response>((resolve) => {
      resolveReportRefetch = resolve;
    });
    const fetchMock = stubFetch({
      failTaskPost: new Response(
        JSON.stringify({
          code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
          message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
        }),
        { status: 409 },
      ),
      reportRefetchPromise,
    });
    renderShare();

    const button = await screen.findByTestId('share-next-task-button');
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('状態未確認')).toBeTruthy();
      expect(screen.queryByRole('link', { name: /外部共有リンクの発行/ })).toBeNull();
      expect(
        (screen.getByRole('button', { name: /外部共有リンクの発行/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });
    expect(toast.error).not.toHaveBeenCalledWith(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);

    resolveReportRefetch(
      new Response(JSON.stringify({ data: archivedReport }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);
      expect(screen.getByText('アーカイブ中')).toBeTruthy();
      expect(screen.getByText('患者がアーカイブされています')).toBeTruthy();
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/care-reports/')),
    ).toHaveLength(2);
    expect(screen.queryByText('次回タスクの作成状態を確認してください')).toBeNull();
    expect(screen.queryByRole('button', { name: '次回タスク作成を再試行' })).toBeNull();
  });

  it('keeps cached report history visible and writes locked when archive reconciliation fails', async () => {
    const fetchMock = stubFetch({
      failTaskPost: new Response(
        JSON.stringify({
          code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
          message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
        }),
        { status: 409 },
      ),
      reportRefetchPromise: Promise.resolve(new Response('server error', { status: 500 })),
    });
    renderShare();

    const taskButton = await screen.findByTestId('share-next-task-button');
    await waitFor(() => expect((taskButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(taskButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);
      expect(screen.getByText('状態未確認')).toBeTruthy();
    });
    expect(screen.getByTestId('share-preview-column')).toBeTruthy();
    expect(screen.getByTestId('share-reply-card')).toBeTruthy();
    expect(screen.getByTestId('share-open-request-link')).toBeTruthy();
    expect((taskButton as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('share-create-request-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: /外部共有リンクの発行/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('button', { name: '患者状態を再取得' })).toBeTruthy();
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '前回取得データを表示中です',
    );
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '最終更新:',
    );
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/care-reports/')),
    ).toHaveLength(2);
  });

  it('hides cached report PHI when archive reconciliation confirms access loss', async () => {
    const fetchMock = stubFetch({
      failTaskPost: new Response(
        JSON.stringify({
          code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
          message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
        }),
        { status: 409 },
      ),
      reportRefetchPromise: Promise.resolve(new Response('forbidden', { status: 403 })),
    });
    renderShare();

    const taskButton = await screen.findByTestId('share-next-task-button');
    await waitFor(() => expect((taskButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(taskButton);

    await waitFor(() => {
      expect(screen.getByText('報告書を取得できませんでした')).toBeTruthy();
    });
    expect(screen.queryByTestId('share-preview-column')).toBeNull();
    expect(screen.queryByTestId('share-reply-card')).toBeNull();
    expect(screen.queryByText('佐藤 花子')).toBeNull();
    expect(screen.queryByTestId('patient-write-availability-notice')).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/care-reports/')),
    ).toHaveLength(2);
  });

  it('clears an archived task error after an explicit active reconciliation', async () => {
    stubFetch({
      failTaskPost: new Response(
        JSON.stringify({
          code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
          message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
        }),
        { status: 409 },
      ),
      refetchedReport: REPORT,
    });
    renderShare();

    const taskButton = await screen.findByTestId('share-next-task-button');
    await waitFor(() => expect((taskButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(taskButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);
      expect((taskButton as HTMLButtonElement).disabled).toBe(false);
    });
    expect(screen.queryByText('患者がアーカイブされています')).toBeNull();
    expect(screen.queryByRole('button', { name: '患者状態を再取得' })).toBeNull();
  });

  it('clears an archived reply-request error after an explicit active reconciliation', async () => {
    stubFetch({
      requests: [],
      failRequestPost: new Response(
        JSON.stringify({
          code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
          message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
        }),
        { status: 409 },
      ),
      refetchedReport: REPORT,
    });
    renderShare();

    const requestButton = await screen.findByTestId('share-create-request-button');
    await waitFor(() => expect((requestButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(requestButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);
      expect((requestButton as HTMLButtonElement).disabled).toBe(false);
    });
    expect(screen.queryByText('患者がアーカイブされています')).toBeNull();
    expect(screen.queryByRole('button', { name: '患者状態を再取得' })).toBeNull();
  });

  it('keeps a 500 reply request failure PHI-safe and leaves retry available', async () => {
    const rawMessage = '患者A 090-1234-5678 token=secret-request-token の起票に失敗しました';
    stubFetch({
      failRequestPost: new Response(
        JSON.stringify({ code: 'INTERNAL_ERROR', message: rawMessage }),
        {
          status: 500,
        },
      ),
    });
    renderShare();

    await waitFor(() => {
      expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5);
    });

    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'physician')!,
    );
    const button = await screen.findByTestId('share-create-request-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        '返信依頼の起票に失敗しました。もう一度お試しください。',
      );
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'care_report.interprofessional_share_reply_request_failed',
      expect.any(Error),
      {
        route: '/reports/:id/share',
        entityType: 'care_report_reply_request',
        status: 500,
      },
    );
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain(rawMessage);
    const [, loggedError] = clientLogWarnMock.mock.calls[0] ?? [];
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).not.toContain(rawMessage);
    expect(screen.getByText('返信依頼を起票できませんでした')).toBeTruthy();
    expect(document.body.textContent).not.toContain(rawMessage);

    fireEvent.click(screen.getByRole('button', { name: '返信依頼を再試行' }));
    await waitFor(() => {
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(
            ([input, init]) =>
              String(input) === '/api/communication-requests' && init?.method === 'POST',
          ),
      ).toHaveLength(2);
    });
    const requestBodies = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([input, init]) =>
          String(input) === '/api/communication-requests' && init?.method === 'POST',
      )
      .map(([, init]) => init?.body);
    expect(requestBodies[1]).toBe(requestBodies[0]);
  });

  it('rechecks reply requests after a 409 and marks the request as created only from fresh data', async () => {
    const rawMessage = '患者A token=secret-conflict-token の依頼は既に起票済みです';
    stubFetch({
      failRequestPost: new Response(
        JSON.stringify({ code: 'WORKFLOW_CONFLICT', message: rawMessage }),
        { status: 409 },
      ),
      refetchedRequests: [
        {
          id: 'req_physician_conflict',
          patient_id: 'pt_1',
          request_type: 'care_report_reply_request',
          recipient_name: '山本 健',
          recipient_role: 'physician',
          related_entity_type: 'care_report',
          related_entity_id: 'rep_1',
          status: 'sent',
          subject: '主治医向け報告書共有',
          requested_at: '2026-06-12T07:40:00.000Z',
          responses: [],
        },
        ...REQUESTS,
      ],
    });
    renderShare();

    await waitFor(() => {
      expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5);
    });
    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'physician')!,
    );
    fireEvent.click(await screen.findByTestId('share-create-request-button'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        '返信依頼は既に起票されている可能性があります。連携依頼の状態を確認しています。',
      );
      expect(screen.getByText('返信依頼起票済み')).toBeTruthy();
    });
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'care_report.interprofessional_share_reply_request_failed',
      expect.any(Error),
      {
        route: '/reports/:id/share',
        entityType: 'care_report_reply_request',
        status: 409,
      },
    );
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain(rawMessage);
    const [, loggedError] = clientLogWarnMock.mock.calls[0] ?? [];
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).not.toContain(rawMessage);
    expect((screen.getByTestId('share-create-request-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('does not misclassify an archived-patient reply 409 as a duplicate request', async () => {
    const archivedReport: ReportFixture = {
      ...REPORT,
      patient_summary: {
        ...REPORT.patient_summary,
        archive: {
          status: 'archived',
          archived: true,
          archived_at: '2026-07-13T00:00:00.000Z',
        },
      },
    };
    const fetchMock = stubFetch({
      requests: [],
      failRequestPost: new Response(
        JSON.stringify({
          code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
          message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
        }),
        { status: 409 },
      ),
      refetchedReport: archivedReport,
    });
    renderShare();

    const button = await screen.findByTestId('share-create-request-button');
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE);
      expect(screen.getByText('アーカイブ中')).toBeTruthy();
      expect(screen.getByText('患者がアーカイブされています')).toBeTruthy();
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/care-reports/')),
    ).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalledWith(
      '返信依頼は既に起票されている可能性があります。連携依頼の状態を確認しています。',
    );
    expect(screen.queryByText('返信依頼起票済み')).toBeNull();
    expect(screen.queryByRole('button', { name: '返信依頼を再試行' })).toBeNull();
  });

  it('communication request and task mutations consume shared API helper return values', async () => {
    const realCommunicationRequestsImpl = vi
      .mocked(buildCommunicationRequestsApiPath)
      .getMockImplementation();
    const realTasksImpl = vi.mocked(buildTasksApiPath).getMockImplementation();
    vi.mocked(buildCommunicationRequestsApiPath).mockImplementation((params) => {
      if (!params) return '/api/communication-requests__sentinel';
      const query =
        params instanceof URLSearchParams
          ? params.toString()
          : new URLSearchParams({
              request_type: params?.requestType ?? '',
              related_entity_type: params?.relatedEntityType ?? '',
              related_entity_id: params?.relatedEntityId ?? '',
            }).toString();
      return query
        ? `/api/communication-requests__sentinel?${query}`
        : '/api/communication-requests__sentinel';
    });
    vi.mocked(buildTasksApiPath).mockReturnValue('/api/tasks__sentinel');
    try {
      const fetchMock = stubFetch();
      renderShare();

      await waitFor(() => {
        expect(screen.getByTestId('share-reply-card')).toBeTruthy();
      });
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).startsWith('/api/communication-requests__sentinel?'),
        ),
      ).toBe(true);

      fireEvent.click(screen.getByTestId('share-next-task-button'));
      await waitFor(() => {
        expect(screen.getByText('次回タスク作成済み')).toBeTruthy();
      });
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input) === '/api/tasks__sentinel' && init?.method === 'POST',
        ),
      ).toBe(true);

      fireEvent.click(
        screen
          .getAllByTestId('share-audience-card')
          .find((card) => card.getAttribute('data-audience') === 'physician')!,
      );
      fireEvent.click(await screen.findByTestId('share-create-request-button'));
      await waitFor(() => {
        expect(screen.getByText('返信依頼起票済み')).toBeTruthy();
      });
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/communication-requests__sentinel' && init?.method === 'POST',
        ),
      ).toBe(true);
    } finally {
      if (realCommunicationRequestsImpl) {
        vi.mocked(buildCommunicationRequestsApiPath).mockImplementation(
          realCommunicationRequestsImpl,
        );
      }
      if (realTasksImpl) {
        vi.mocked(buildTasksApiPath).mockImplementation(realTasksImpl);
      }
    }
  });

  it('共有相手が未登録の宛先では返信依頼を起票しない', async () => {
    const fetchMock = stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getAllByTestId('share-audience-card')).toHaveLength(5);
    });

    fireEvent.click(
      screen
        .getAllByTestId('share-audience-card')
        .find((card) => card.getAttribute('data-audience') === 'visiting_nurse')!,
    );

    const button = screen.getByTestId('share-create-request-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByText('ケアチームまたは連絡先に共有相手を登録すると、返信依頼を起票できます。'),
    ).toBeTruthy();
    fireEvent.click(button);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === '/api/communication-requests' && init?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('keeps hostile report, patient, and request identities raw in the follow-up task body', async () => {
    const hostileReportId = 'rep/1?mode=x#frag';
    const hostilePatientId = 'pt/1?tab=x#frag';
    const hostileRequestId = 'req/1?x=y#z';
    const fetchMock = stubFetch({
      report: {
        ...REPORT,
        id: hostileReportId,
        patient_id: hostilePatientId,
        patient_summary: { ...REPORT.patient_summary, id: hostilePatientId },
      },
      requests: [
        {
          ...REQUESTS[0],
          id: hostileRequestId,
          patient_id: hostilePatientId,
          related_entity_id: hostileReportId,
        },
      ],
      requestDetail: {
        ...REQUEST_DETAIL,
        id: hostileRequestId,
        patient_id: hostilePatientId,
        related_entity_id: hostileReportId,
      },
    });
    renderShare(hostileReportId);

    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('share-next-task-button'));

    await waitFor(() => {
      expect(screen.getByText('次回タスク作成済み')).toBeTruthy();
    });

    expect(
      fetchMock.mock.calls.some(
        ([input]) => String(input) === `/api/care-reports/${encodeURIComponent(hostileReportId)}`,
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes(`/api/patients/${encodeURIComponent(hostilePatientId)}/care-team`),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input]) =>
          String(input) === `/api/communication-requests/${encodeURIComponent(hostileRequestId)}`,
      ),
    ).toBe(true);
    const body = readTaskPostBody(fetchMock);
    expect(body.related_entity_id).toBe(hostilePatientId);
    expect(body.metadata.report_id).toBe(hostileReportId);
    expect(body.metadata.communication_request_id).toBe(hostileRequestId);
    expect(body.dedupe_key).toBe('share-reply-task:res_1');
  });

  it('allows preview and replies but blocks follow-up task creation without task permission', async () => {
    const fetchMock = stubFetch({
      report: {
        ...REPORT,
        permissions: {
          can_edit: true,
          can_send: true,
          can_create_external_share: true,
          can_create_followup_task: false,
          can_view_patient: true,
          can_view_related_requests: true,
        },
      },
    });
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-preview-column')).toBeTruthy();
      expect(screen.getByTestId('share-reply-card')).toBeTruthy();
    });

    const button = screen.getByTestId('share-next-task-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByText('運用タスクの作成権限がないため、返信内容は閲覧のみできます。'),
    ).toBeTruthy();
    fireEvent.click(button);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input) === '/api/tasks' && init?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('view-only report permissions hide external share and disable follow-up task creation', async () => {
    const fetchMock = stubFetch({
      report: {
        ...REPORT,
        content: undefined,
        patient_summary: null,
        permissions: {
          can_edit: false,
          can_send: false,
          can_create_external_share: false,
          can_create_followup_task: false,
          can_view_patient: false,
          can_view_related_requests: false,
        },
      },
    });
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-permission-warning')).toBeTruthy();
    });

    expect(screen.queryByRole('link', { name: /外部共有リンクの発行/ })).toBeNull();
    expect(screen.queryByRole('link', { name: '患者詳細' })).toBeNull();
    expect(screen.queryByTestId('patient-write-availability-notice')).toBeNull();
    expect(
      screen.getByText(
        'この報告書の外部共有または送付権限がないため、共有プレビューと返信確認は表示できません。',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('share-preview-column')).toBeNull();
    expect(screen.queryByTestId('share-reply-card')).toBeNull();
    expect(screen.queryByTestId('share-next-task-button')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/tasks', expect.anything());
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/care-team'))).toBe(
      false,
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/contacts'))).toBe(false);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/api/communication-requests')),
    ).toBe(false);
  });

  it('marks a non-shareable cached report stale after a retryable refetch failure', async () => {
    const queryClient = createTestQueryClient();
    stubFetch({
      report: {
        ...REPORT,
        permissions: {
          ...REPORT.permissions,
          can_send: false,
          can_create_external_share: false,
        },
      },
      reportRefetchPromise: Promise.resolve(new Response('server error', { status: 500 })),
    });
    render(<InterprofessionalShareContent reportId="rep_1" />, {
      wrapper: createQueryClientWrapper(queryClient),
    });

    await waitFor(() => expect(screen.getByTestId('share-permission-warning')).toBeTruthy());
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['care-report', 'rep_1', 'org_1'] });
    });

    await waitFor(() => {
      expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
        '前回取得データを表示中です',
      );
    });
    expect(screen.getByTestId('share-permission-warning')).toBeTruthy();
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '最終更新:',
    );
  });

  it('does not manually refetch patient support queries from retry when patient viewing is denied', async () => {
    const fetchMock = stubFetch({
      failRequests: true,
      report: {
        ...REPORT,
        patient_summary: null,
        permissions: {
          can_edit: true,
          can_send: true,
          can_create_external_share: true,
          can_create_followup_task: true,
          can_view_patient: false,
          can_view_related_requests: true,
        },
      },
    });
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-supporting-data-warning')).toBeTruthy();
    });
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '状態確認権限なし',
    );
    expect(screen.getByTestId('patient-write-availability-notice').textContent).toContain(
      '権限を持つ担当者へ確認してください',
    );
    expect((screen.getByTestId('share-create-request-button') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId('share-next-task-button') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '再取得' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes('/api/communication-requests?'),
        ).length,
      ).toBeGreaterThan(1);
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/care-team'))).toBe(
      false,
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/contacts'))).toBe(false);
  });

  it('both patient share links consume the shared buildPatientHref return value (not raw interpolation)', async () => {
    const fetchMock = stubFetch();
    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/patients/__sentinel_${id}__${suffix}`,
    );
    try {
      renderShare();

      const patientLink = await screen.findByRole('link', { name: '患者詳細' });
      expect(patientLink.getAttribute('href')).toBe('/patients/__sentinel_pt_1__');
      const shareLink = await screen.findByRole('link', { name: /外部共有リンクの発行/ });
      expect(shareLink.getAttribute('href')).toBe('/patients/__sentinel_pt_1__/share');

      expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith('pt_1');
      expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith('pt_1', '/share');

      // Browser href helper sentinel must NOT leak into API/task paths.
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(([input]) =>
            String(input).includes(`/api/patients/${encodeURIComponent('pt_1')}/care-team`),
          ),
        ).toBe(true);
      });
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('__sentinel_'))).toBe(
        false,
      );
    } finally {
      if (realImpl) {
        vi.mocked(buildPatientHref).mockImplementation(realImpl);
      }
    }
  });

  it('patient support GETs consume the shared buildPatientApiPath return value', async () => {
    const fetchMock = stubFetch();
    const realImpl = vi.mocked(buildPatientApiPath).getMockImplementation();
    vi.mocked(buildPatientApiPath).mockImplementation(
      (id: string, suffix = '') => `/api/patients/__sentinel_${id}__${suffix}`,
    );
    try {
      renderShare();

      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(
            ([input]) =>
              String(input) === '/api/patients/__sentinel_pt_1__/care-team?case_id=case_1',
          ),
        ).toBe(true);
        expect(
          fetchMock.mock.calls.some(
            ([input]) => String(input) === '/api/patients/__sentinel_pt_1__/contacts',
          ),
        ).toBe(true);
      });
      expect(vi.mocked(buildPatientApiPath)).toHaveBeenCalledWith('pt_1', '/care-team');
      expect(vi.mocked(buildPatientApiPath)).toHaveBeenCalledWith('pt_1', '/contacts');
    } finally {
      if (realImpl) {
        vi.mocked(buildPatientApiPath).mockImplementation(realImpl);
      }
    }
  });

  it('encodes a hostile patient id as a single path segment in both share links', async () => {
    const hostilePatientId = 'pt/1?tab=x#frag';
    const fetchMock = stubFetch({
      report: {
        ...REPORT,
        patient_id: hostilePatientId,
        patient_summary: { ...REPORT.patient_summary, id: hostilePatientId },
      },
    });
    renderShare();

    const patientLink = await screen.findByRole('link', { name: '患者詳細' });
    expect(patientLink.getAttribute('href')).toBe(
      `/patients/${encodeURIComponent(hostilePatientId)}`,
    );
    const shareLink = await screen.findByRole('link', { name: /外部共有リンクの発行/ });
    expect(shareLink.getAttribute('href')).toBe(
      `/patients/${encodeURIComponent(hostilePatientId)}/share`,
    );

    for (const link of [patientLink, shareLink]) {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toContain('pt/1');
      expect(href).not.toContain('?tab=');
      expect(href).not.toContain('#frag');
    }
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes(
            `/api/patients/${encodeURIComponent(hostilePatientId)}/care-team?case_id=case_1`,
          ),
        ),
      ).toBe(true);
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            String(input) === `/api/patients/${encodeURIComponent(hostilePatientId)}/contacts`,
        ),
      ).toBe(true);
    });
    const patientFetchUrls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.startsWith('/api/patients/'));
    for (const url of patientFetchUrls) {
      expect(url).not.toContain('pt/1');
      expect(url).not.toContain('?tab=');
      expect(url).not.toContain('#frag');
      expect(url).not.toContain('%25');
    }
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
  });

  it('encodes a hostile report id in the report API path and back link while keeping list query identity raw', async () => {
    const hostileReportId = 'rep/1?mode=x#frag';
    const fetchMock = stubFetch({
      report: {
        ...REPORT,
        id: hostileReportId,
      },
    });
    renderShare(hostileReportId);

    const backLink = await screen.findByRole('link', { name: '報告書詳細へ戻る' });
    expect(backLink.getAttribute('href')).toBe(`/reports/${encodeURIComponent(hostileReportId)}`);
    expect(vi.mocked(buildReportHref)).toHaveBeenCalledWith(hostileReportId);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input]) => String(input) === `/api/care-reports/${encodeURIComponent(hostileReportId)}`,
        ),
      ).toBe(true);
    });
    const requestListUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.startsWith('/api/communication-requests?'));
    expect(requestListUrl).toBeTruthy();
    const requestParams = new URLSearchParams(requestListUrl?.split('?')[1]);
    expect(requestParams.get('request_type')).toBe('care_report_reply_request');
    expect(requestParams.get('related_entity_id')).toBe(hostileReportId);
    expect(requestListUrl).toContain('request_type=care_report_reply_request');
    expect(requestListUrl).toContain(`related_entity_id=${encodeURIComponent(hostileReportId)}`);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/care-reports/rep/1?mode=x#frag'),
      ),
    ).toBe(false);
  });

  it('encodes a hostile reply request id for detail fetch while the task body keeps raw identities', async () => {
    const hostileRequestId = 'req/1?x=y#z';
    const fetchMock = stubFetch({
      requests: [{ ...REQUESTS[0], id: hostileRequestId }],
      requestDetail: { ...REQUEST_DETAIL, id: hostileRequestId },
    });
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card')).toBeTruthy();
    });

    expect(
      fetchMock.mock.calls.some(
        ([input]) =>
          String(input) === `/api/communication-requests/${encodeURIComponent(hostileRequestId)}`,
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/communication-requests/req/1?x=y#z'),
      ),
    ).toBe(false);

    fireEvent.click(screen.getByTestId('share-next-task-button'));
    await waitFor(() => {
      expect(screen.getByText('次回タスク作成済み')).toBeTruthy();
    });
    const body = readTaskPostBody(fetchMock);
    expect(body.related_entity_id).toBe('pt_1');
    expect(body.metadata.report_id).toBe('rep_1');
    expect(body.metadata.communication_request_id).toBe(hostileRequestId);
    expect(body.dedupe_key).toBe('share-reply-task:res_1');
  });

  it.each(['.', '..'])(
    'fails closed before fetching when report id is an exact dot segment: %s',
    async (dotReportId) => {
      const fetchMock = stubFetch();
      renderShare(dotReportId);

      await waitFor(() => {
        expect(screen.getByText('報告書を取得できませんでした')).toBeTruthy();
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['.', '..'])(
    'fails closed before fetching reply detail when request id is an exact dot segment: %s',
    async (dotRequestId) => {
      const fetchMock = stubFetch({
        requests: [{ ...REQUESTS[0], id: dotRequestId }],
      });
      renderShare();

      await waitFor(() => {
        expect(screen.getByTestId('share-supporting-data-warning')).toBeTruthy();
      });
      expect(
        fetchMock.mock.calls.some(
          ([input]) => String(input) === `/api/communication-requests/${dotRequestId}`,
        ),
      ).toBe(false);
      expect(screen.queryByTestId('share-reply-card')).toBeNull();
      expect((screen.getByTestId('share-next-task-button') as HTMLButtonElement).disabled).toBe(
        true,
      );
    },
  );

  it.each(['.', '..'])(
    'fails closed before patient support fetches when patient id is an exact dot segment: %s',
    async (dotPatientId) => {
      const fetchMock = stubFetch({
        report: {
          ...REPORT,
          patient_id: dotPatientId,
          patient_summary: { ...REPORT.patient_summary, id: dotPatientId },
        },
      });
      renderShare();

      await waitFor(() => {
        expect(screen.getByTestId('share-supporting-data-warning')).toBeTruthy();
      });
      expect(screen.getByText(/患者リンクを取得できないため/)).toBeTruthy();
      expect(screen.queryByRole('link', { name: '患者詳細' })).toBeNull();
      expect(screen.queryByRole('link', { name: /外部共有リンクの発行/ })).toBeNull();
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/patients/')),
      ).toBe(false);
    },
  );
});
