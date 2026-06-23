// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { InterprofessionalShareContent } from './interprofessional-share-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
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

const REPORT = {
  id: 'rep_1',
  patient_id: 'pt_1',
  case_id: 'case_1',
  report_type: 'care_manager_report',
  status: 'sent',
  pdf_url: null,
  patient_summary: { id: 'pt_1', name: '加藤 ミサ' },
  permissions: {
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
};

const CARE_TEAM = [
  { role: 'physician', name: '山本 健', organization_name: 'やまもと内科', is_primary: true },
  {
    role: 'care_manager',
    name: '中島 桜',
    organization_name: 'きたきゅうケアプラン',
    is_primary: true,
  },
];

const CONTACTS = [
  { relation: 'child', name: '加藤 直子', organization_name: null, is_primary: true },
];

const REQUESTS = [
  {
    id: 'req_1',
    recipient_name: '中島 桜',
    recipient_role: 'care_manager',
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
    report?: typeof REPORT;
    requests?: typeof REQUESTS;
    requestDetail?: typeof REQUEST_DETAIL;
  } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/care-reports/')) {
      return new Response(JSON.stringify({ data: options.report ?? REPORT }), { status: 200 });
    }
    // match by suffix so a hostile report.patient_id API path still stubs ok
    // (the href behavior, not fetch plumbing, is what these tests exercise).
    if (url.includes('/care-team')) {
      if (options.failCareTeam) {
        return new Response('server error', { status: 500 });
      }
      return new Response(JSON.stringify({ data: CARE_TEAM }), { status: 200 });
    }
    if (url.includes('/contacts')) {
      return new Response(JSON.stringify({ data: CONTACTS }), { status: 200 });
    }
    if (url.includes('/api/communication-requests?')) {
      if (options.failRequests) {
        return new Response('server error', { status: 500 });
      }
      return new Response(JSON.stringify({ data: options.requests ?? REQUESTS }), { status: 200 });
    }
    if (url.startsWith('/api/communication-requests/')) {
      return new Response(JSON.stringify({ data: options.requestDetail ?? REQUEST_DETAIL }), {
        status: 200,
      });
    }
    if (url.includes('/api/tasks') && init?.method === 'POST') {
      return new Response(JSON.stringify({ data: { id: 'task_1' } }), { status: 201 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderShare(reportId = 'rep_1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InterprofessionalShareContent reportId={reportId} />
    </QueryClientProvider>,
  );
}

function expectFetchHeaders(
  fetchMock: ReturnType<typeof stubFetch>,
  matcher: (url: string) => boolean,
  expectedHeaders: Record<string, string>,
) {
  const call = fetchMock.mock.calls.find(([input]) => matcher(String(input)));
  expect(call?.[1]?.headers).toEqual(expectedHeaders);
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

describe('InterprofessionalShareContent', () => {
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
      '添付資料',
    ]);
    expect(screen.getByText(/昼分の飲み忘れが週2回/)).toBeTruthy();

    // 右: ケアマネからの返信と主操作
    expect(screen.getByText('ケアマネからの返信')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card').textContent).toContain(
        'ヘルパーへ声かけ依頼済み',
      );
    });
  });

  it('uses the org header on every share GET request', async () => {
    const fetchMock = stubFetch();
    renderShare();

    await waitFor(() => {
      expect(screen.getByTestId('share-reply-card')).toBeTruthy();
    });

    const orgHeader = buildOrgHeaders('org_1');
    expectFetchHeaders(fetchMock, (url) => url.startsWith('/api/care-reports/'), orgHeader);
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
    const body = readTaskPostBody(fetchMock);
    expect(body.task_type).toBe('report_response_followup');
    expect(body.dedupe_key).toBe('share-reply-task:res_1');
    expect(body.related_entity_type).toBe('patient');
    expect(body.related_entity_id).toBe('pt_1');
    expect(body.title).toContain('ケアマネからの返信');

    // 起票済みの返信では再実行できない
    expect((screen.getByTestId('share-next-task-button') as HTMLButtonElement).disabled).toBe(true);
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
      requests: [{ ...REQUESTS[0], id: hostileRequestId }],
      requestDetail: { ...REQUEST_DETAIL, id: hostileRequestId },
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
        permissions: {
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

  it('does not manually refetch patient support queries from retry when patient viewing is denied', async () => {
    const fetchMock = stubFetch({
      failRequests: true,
      report: {
        ...REPORT,
        permissions: {
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
    expect(requestParams.get('related_entity_id')).toBe(hostileReportId);
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
      const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
      vi.mocked(buildPatientHref).mockImplementation(
        (id: string, suffix = '') => `/patients/__sentinel_${id}__${suffix}`,
      );
      try {
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
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/patients/')),
        ).toBe(false);
      } finally {
        if (realImpl) {
          vi.mocked(buildPatientHref).mockImplementation(realImpl);
        }
      }
    },
  );
});
