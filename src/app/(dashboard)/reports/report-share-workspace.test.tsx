// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type { ReportsTodayWorkspaceResponse } from '@/types/reports-today-workspace';
import { buildReportHref } from '@/lib/reports/navigation';
import { ReportShareWorkspace } from './report-share-workspace';
import {
  buildHeaderMeta,
  buildWorkspaceNextAction,
  waitingBadgeLabel,
} from './report-share-workspace.helpers';

setupDomTestEnv();

function localIso(year: number, monthIndex: number, day: number, hour: number, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute).toISOString();
}

beforeEach(() => {
  useUIStore.setState({ workspaceRailOpen: true });
});

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Actual-backed spy: real encode/guard output for the hostile test, plus
// return-value delegation teeth for the post-generate router.push navigation.
vi.mock('@/lib/reports/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/reports/navigation')>();
  return { ...actual, buildReportHref: vi.fn(actual.buildReportHref) };
});

const TODAY_WORKSPACE: ReportsTodayWorkspaceResponse = {
  generated_at: '2026-06-11T00:00:00.000Z',
  draft_rows: [
    {
      id: 'row_1',
      time_start: '2026-06-11T01:30:00.000Z',
      patient_label: '伊藤 キヨ 様',
      recipient_label: 'ケアマネ(中島様)',
      status: 'before_visit',
      visit_record_id: null,
      visit_record_updated_at: null,
      note: null,
      action: { label: '→ 訪問へ', href: '/visits' },
    },
    {
      id: 'row_2',
      time_start: '2026-06-11T05:00:00.000Z',
      patient_label: '田中 一郎 様',
      recipient_label: '医師(山本先生)+ケアマネ',
      status: 'ready_to_generate',
      visit_record_id: 'vr_2',
      visit_record_updated_at: '2026-06-11T04:45:00.000Z',
      note: '麻薬使用状況を含む',
      action: null,
    },
    {
      id: 'row_3',
      time_start: '2026-06-11T06:30:00.000Z',
      patient_label: '施設グリーンヒル',
      recipient_label: '施設(看護師長)',
      status: 'before_visit',
      visit_record_id: null,
      visit_record_updated_at: null,
      note: '12名分を1通に集約',
      action: null,
    },
  ],
  waiting_replies: [
    {
      id: 'wait_1',
      kind: 'report_delivery',
      waiting_days: 3,
      title: '加藤 ミサ 様 — ケアマネへの服薬状況報告',
      subtitle: '再送は前回送付の記録つきで送られます',
      actions: [{ label: '再送する', href: '/reports/rep_1', kind: 'button' }],
    },
    {
      id: 'wait_2',
      kind: 'inquiry',
      waiting_days: 2,
      title: '高橋 茂 様 — みどり医院への疑義照会',
      subtitle: null,
      actions: [
        { label: '電話で確認', href: '/communications', kind: 'button' },
        { label: '→ カードへ', href: '/patients/p_1', kind: 'link' },
      ],
    },
  ],
  resolved_today: [
    {
      id: 'res_1',
      received_at: '2026-06-11T00:31:00.000Z',
      title: '佐々木 ハル 様 — 残薬照会(やまもと内科)',
      subtitle: '回答は調剤画面に自動で反映済み。返信のお礼は不要の設定です。',
      action: { label: '→ 調剤へ', href: '/dispense' },
    },
  ],
  created_reports: [
    {
      id: 'report_sent',
      patient_id: 'patient_1',
      patient_label: '田中 一郎 様',
      report_type: 'physician_report',
      report_type_label: '医師への報告',
      status: 'sent',
      status_label: '送付済',
      title: '主治医への服薬状況報告',
      created_at: '2026-06-10T01:00:00.000Z',
      updated_at: '2026-06-11T02:00:00.000Z',
      reported_to_professional: true,
      last_sent_at: localIso(2026, 5, 11, 11, 10),
      last_recipient_label: '山田 太郎',
      last_channel: 'fax',
      failed_delivery: null,
      action: { label: '→ 詳細へ', href: '/reports/report_sent' },
    },
    {
      id: 'report_draft',
      patient_id: 'patient_2',
      patient_label: '加藤 ミサ 様',
      report_type: 'care_manager_report',
      report_type_label: 'ケアマネへの報告',
      status: 'draft',
      status_label: '下書き',
      title: 'ケアマネへの共有',
      created_at: '2026-06-11T03:00:00.000Z',
      updated_at: '2026-06-11T03:30:00.000Z',
      reported_to_professional: false,
      last_sent_at: null,
      last_recipient_label: null,
      last_channel: null,
      failed_delivery: null,
      action: { label: '→ 詳細へ', href: '/reports/report_draft' },
    },
    {
      id: 'report_failed',
      patient_id: 'patient_3',
      patient_label: '高橋 茂 様',
      report_type: 'physician_report',
      report_type_label: '医師への報告',
      status: 'failed',
      status_label: '送付失敗',
      title: '主治医への再送確認',
      created_at: '2026-06-11T04:00:00.000Z',
      updated_at: '2026-06-11T04:30:00.000Z',
      reported_to_professional: false,
      last_sent_at: null,
      last_recipient_label: null,
      last_channel: null,
      failed_delivery: {
        delivery_record_id: 'delivery_failed',
        recipient_label: 'やまもと内科',
        channel: 'email',
        failure_reason: 'メール送信に失敗しました',
        retry_count: 1,
        failed_at: '2026-06-11T04:40:00.000Z',
        action: { label: '宛先確認・再送', href: '/reports/report_failed' },
      },
      action: { label: '→ 詳細へ', href: '/reports/report_failed' },
    },
  ],
  open_issues: [
    {
      kind: 'report',
      id: 'report_draft-draft-confirmation',
      report_id: 'report_draft',
      severity: 'critical',
      title: '加藤 ミサ 様 — 薬剤師確認待ち',
      description: '下書きのため、他職種への送付とPDF出力はできません。',
      action: { label: '確認する', href: '/reports/report_draft' },
    },
    {
      kind: 'report',
      id: 'report_draft-billing-context',
      report_id: 'report_draft',
      severity: 'warning',
      title: '加藤 ミサ 様 — 保険・請求根拠未確定',
      description: '保険種別と算定根拠が報告書contentに記録されていません。',
      action: { label: '根拠を確認', href: '/reports/report_draft' },
    },
  ],
  counts: { to_write: 3, waiting: 2, resolved: 1, created: 3, open_issues: 2 },
  evidence: { template_count: 3, monthly_delivery_count: 14 },
};

const COCKPIT: DashboardCockpitResponse = {
  generated_at: '2026-06-11T00:00:00.000Z',
  cycle_status_counts: {},
  audit_pending_count: 1,
  narcotic_audit_count: 1,
  audit_queue: [
    {
      task_id: 'task_1',
      cycle_id: 'cycle_1',
      patient_name: '田中 一郎',
      priority: 'normal',
      due_at: localIso(2026, 5, 11, 12),
      intake_id: 'intake_1',
      prescribed_date: '2026-06-01',
      handling_tags: ['narcotic'],
      has_narcotic: true,
      waiting_since: null,
    },
  ],
  today_visits: [
    {
      id: 'visit_1',
      patient_name: '田中 一郎',
      visit_type: 'regular',
      schedule_status: 'planned',
      time_start: localIso(2026, 5, 11, 14),
      time_end: localIso(2026, 5, 11, 14, 30),
      facility_batch_id: null,
    },
  ],
  blocked_reasons: [
    {
      id: 'block_1',
      label: 'ご家族の同意待ち(新規契約)',
      severity: 'critical',
      category: '患者',
      age_minutes: 25 * 60,
      action_label: '再連絡する →',
      action_href: '/communications/requests',
    },
    {
      id: 'block_2',
      label: '送付先の確認(やまもと内科)',
      severity: 'warning',
      category: '事務',
      age_minutes: 30,
      action_label: '状況を見る →',
      action_href: '/admin/contact-profiles',
    },
  ],
  carryover_count: 0,
  team_capacity: [],
};

function stubFetch(
  workspace: ReportsTodayWorkspaceResponse = TODAY_WORKSPACE,
  generatedReportId = 'rep_generated',
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/care-reports/today-workspace')) {
      return new Response(JSON.stringify({ data: workspace }), { status: 200 });
    }
    if (url.includes('/api/dashboard/cockpit')) {
      return new Response(JSON.stringify({ data: COCKPIT }), { status: 200 });
    }
    if (url.includes('/api/care-reports/generate-from-visit')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: generatedReportId,
              report_type: 'care_manager_report',
              status: 'draft',
              updated_at: '2026-06-11T05:00:00.000Z',
            },
          ],
        }),
        { status: 201 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportShareWorkspace />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  routerPushMock.mockClear();
});

describe('ReportShareWorkspace', () => {
  it('renders the 報告・共有 workspace: drafts table, waiting boxes and policy bar', async () => {
    stubFetch();
    renderWorkspace();

    expect(screen.getByText('報告・共有')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('report-today-drafts')).toBeTruthy();
    });

    // ヘッダーメタ(書く/待つ/解決の当日件数)
    expect(screen.getByText(/書く3件・課題2件・作成済み3件・待つ2件・解決1件/)).toBeTruthy();
    // テンプレート編集はアウトライン副操作
    expect(screen.getByTestId('report-edit-templates').textContent).toContain('テンプレートを編集');

    // 今日書く報告: 宛先と状態
    expect(screen.getByText('未作成・下書き一覧 — 訪問完了後に選択して作成')).toBeTruthy();
    expect(screen.getByText('伊藤 キヨ 様')).toBeTruthy();
    expect(screen.getByText('ケアマネ(中島様)')).toBeTruthy();
    expect(screen.getByText('医師(山本先生)+ケアマネ')).toBeTruthy();
    expect(screen.getAllByText('訪問後に下書き')).toHaveLength(2);
    expect(screen.getByText('未作成')).toBeTruthy();
    // 危険区分メモは隠さない
    expect(screen.getByText('麻薬使用状況を含む')).toBeTruthy();
    expect(screen.getByText('12名分を1通に集約')).toBeTruthy();
    // メモがある行でも下書き/訪問導線を隠さない
    expect(screen.getAllByRole('link', { name: '→ 訪問へ' })).toHaveLength(1);
    expect(
      screen.getByRole('button', {
        name: '田中 一郎 様 医師(山本先生)+ケアマネ の下書きを自動作成',
      }),
    ).toBeTruthy();

    // 残課題 / 作成済み報告書: 他職種報告済みかどうかと送信日時を表示する
    expect(screen.getByTestId('report-open-issues')).toBeTruthy();
    expect(screen.getByText('加藤 ミサ 様 — 薬剤師確認待ち')).toBeTruthy();
    expect(screen.getByText('加藤 ミサ 様 — 保険・請求根拠未確定')).toBeTruthy();
    expect(screen.getByTestId('report-created-list')).toBeTruthy();
    expect(screen.getByText('作成済み報告書')).toBeTruthy();

    // Slice1: 即時対応優先(guidelines §68-76)。返信待ち(=止まっている)を残課題・作成済みより前に出す。
    const waiting = screen.getAllByTestId('report-waiting-reply')[0];
    const issues = screen.getByTestId('report-open-issues');
    const created = screen.getByTestId('report-created-list');
    expect(waiting.compareDocumentPosition(issues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      waiting.compareDocumentPosition(created) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '田中 一郎 様' }).getAttribute('href')).toBe(
      '/patients/patient_1',
    );
    expect(
      screen.getByText((text) => text.includes('医師への報告 / 主治医への服薬状況報告')),
    ).toBeTruthy();
    expect(screen.getByText('他職種へ報告済み')).toBeTruthy();
    expect(screen.getByText(/06\/11 11:10 \/ 山田 太郎 \/ FAX/)).toBeTruthy();
    expect(screen.getByText('他職種未報告')).toBeTruthy();
    expect(screen.getAllByText('送付失敗').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('メール / やまもと内科 / 再送1回')).toBeTruthy();
    expect(screen.getByText('メール送信に失敗しました')).toBeTruthy();
    expect(screen.getByRole('link', { name: '宛先確認・再送' }).getAttribute('href')).toBe(
      '/reports/report_failed',
    );

    // 返信待ち / 今日解決した待ち
    expect(screen.getByText('返信待ち')).toBeTruthy();
    expect(screen.getByText('3日経過')).toBeTruthy();
    expect(screen.getByText('再送する')).toBeTruthy();
    expect(screen.getByText('電話で確認')).toBeTruthy();
    expect(screen.getByText('今日解決した待ち')).toBeTruthy();
    expect(screen.getByText(/回答受領/)).toBeTruthy();
    expect(screen.getByText('佐々木 ハル 様 — 残薬照会(やまもと内科)')).toBeTruthy();

    // テンプレート方針バー(実施→観察→提案)
    expect(screen.getByTestId('report-template-policy-bar').textContent).toContain(
      '実施したこと → 観察したこと → 提案',
    );
  });

  it('renders billing candidate open issues using their own action href', async () => {
    stubFetch({
      ...TODAY_WORKSPACE,
      open_issues: [
        {
          kind: 'billing_candidate',
          id: 'billing-candidate-candidate_1',
          billing_candidate_id: 'candidate_1',
          patient_id: 'patient_1',
          severity: 'critical',
          title: '加藤 ミサ 様 — 算定候補の確認待ち',
          description:
            '在宅患者訪問薬剤管理指導料: 算定候補レビューでブロックされています。請求候補画面で根拠を確認してください。',
          action: {
            label: '算定候補へ',
            href: '/billing/candidates?billing_month=2026-06-01&candidate_id=candidate_1&patient_id=patient_1',
          },
        },
      ],
      counts: { ...TODAY_WORKSPACE.counts, open_issues: 1 },
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('report-open-issues')).toBeTruthy();
    });

    const issueLink = screen.getByRole('link', { name: '算定候補へ' });
    expect(issueLink.getAttribute('href')).toBe(
      '/billing/candidates?billing_month=2026-06-01&candidate_id=candidate_1&patient_id=patient_1',
    );
    expect(issueLink.getAttribute('href')).not.toBe('/reports/null');
  });

  it('encodes created-report patient links and keeps unassigned reports as text', async () => {
    const workspace = JSON.parse(JSON.stringify(TODAY_WORKSPACE)) as ReportsTodayWorkspaceResponse;
    workspace.created_reports = [
      {
        ...workspace.created_reports[0],
        patient_id: '../settings?x=1#y',
      },
      {
        ...workspace.created_reports[1],
        patient_id: null,
        patient_label: '患者未設定',
      },
    ];
    workspace.counts = { ...workspace.counts, created: 2 };

    stubFetch(workspace);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('report-created-list')).toBeTruthy();
    });

    const linkedPatient = screen.getByRole('link', { name: '田中 一郎 様' });
    expect(linkedPatient.getAttribute('href')).toBe(
      `/patients/${encodeURIComponent('../settings?x=1#y')}`,
    );
    expect(linkedPatient.getAttribute('href')).not.toContain('/settings');
    expect(linkedPatient.getAttribute('href')).not.toContain('?x=1');
    expect(linkedPatient.getAttribute('href')).not.toContain('#y');

    expect(screen.getByText('患者未設定').closest('a')).toBeNull();
  });

  it('creates a report draft from a selected not-created row and opens the draft', async () => {
    const fetchMock = stubFetch();
    renderWorkspace();

    const generateButton = await screen.findByRole('button', {
      name: '田中 一郎 様 医師(山本先生)+ケアマネ の下書きを自動作成',
    });
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/generate-from-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
        body: JSON.stringify({
          visit_record_id: 'vr_2',
          expected_visit_record_updated_at: '2026-06-11T04:45:00.000Z',
        }),
      });
    });
    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith('/reports/rep_generated');
    });
  });

  it('navigates to the generated draft via the shared buildReportHref return value', async () => {
    stubFetch();
    const realImpl = vi.mocked(buildReportHref).getMockImplementation();
    vi.mocked(buildReportHref).mockImplementation((id: string) => `/reports/__sentinel_${id}__`);
    vi.mocked(buildReportHref).mockClear();
    try {
      renderWorkspace();

      fireEvent.click(
        await screen.findByRole('button', {
          name: '田中 一郎 様 医師(山本先生)+ケアマネ の下書きを自動作成',
        }),
      );

      await waitFor(() => {
        expect(routerPushMock).toHaveBeenCalledWith('/reports/__sentinel_rep_generated__');
      });
      expect(vi.mocked(buildReportHref).mock.calls).toEqual([['rep_generated']]);
    } finally {
      if (realImpl) {
        vi.mocked(buildReportHref).mockImplementation(realImpl);
      }
    }
  });

  it('encodes a hostile generated report id in the post-create navigation', async () => {
    stubFetch(TODAY_WORKSPACE, 'report/1?x=y#z');
    renderWorkspace();

    fireEvent.click(
      await screen.findByRole('button', {
        name: '田中 一郎 様 医師(山本先生)+ケアマネ の下書きを自動作成',
      }),
    );

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith(
        `/reports/${encodeURIComponent('report/1?x=y#z')}`,
      );
    });
    const pushedHrefs = routerPushMock.mock.calls.map((call) => String(call[0]));
    expect(pushedHrefs.some((href) => href.includes('?x=y'))).toBe(false);
    expect(pushedHrefs.some((href) => href.includes('#z'))).toBe(false);
  });

  it('does not render unsafe raw failure reasons from failed deliveries', async () => {
    const workspace = JSON.parse(JSON.stringify(TODAY_WORKSPACE)) as ReportsTodayWorkspaceResponse;
    const failedReport = workspace.created_reports.find((report) => report.id === 'report_failed');
    if (!failedReport?.failed_delivery) throw new Error('failed delivery fixture is required');
    failedReport.failed_delivery.failure_reason = 'SMTP 550 doctor@example.com 090-1234-5678';

    stubFetch(workspace);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('送付失敗').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/doctor@example\.com/)).toBeNull();
    expect(screen.queryByText(/090-1234-5678/)).toBeNull();
    expect(screen.queryByText(/SMTP 550/)).toBeNull();
  });

  it('renders the shared action rail (next action, blocked reasons, evidence)', async () => {
    stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-action-rail')).toBeTruthy();
    });

    // 次にやること: 麻薬監査が主操作(青)・期限付き
    await waitFor(() => {
      expect(screen.getByText('麻薬監査を開始 — 12:00期限')).toBeTruthy();
    });
    expect(
      screen.getByText('14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。'),
    ).toBeTruthy();

    // 止まっている理由(カテゴリ+経過+個別アクション)
    expect(screen.getByText('止まっている理由')).toBeTruthy();
    expect(screen.getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(screen.getByText('送付先の確認(やまもと内科)')).toBeTruthy();
    expect(screen.getByText('1日')).toBeTruthy();
    expect(screen.getByText('30分')).toBeTruthy();

    // 根拠・記録
    expect(screen.getByText('送付テンプレート')).toBeTruthy();
    expect(screen.getByText('3種')).toBeTruthy();
    expect(screen.getByText('送付履歴')).toBeTruthy();
    expect(screen.getByText('今月14件')).toBeTruthy();
    expect(screen.getByText('既読確認')).toBeTruthy();
    expect(screen.getByText('ポータル連携')).toBeTruthy();
  });
});

describe('report-share-workspace helpers', () => {
  it('builds header meta with counts', () => {
    expect(buildHeaderMeta(new Date(2026, 5, 11), TODAY_WORKSPACE.counts)).toMatch(
      /^6\/11\(木\) — 書く3件・課題2件・作成済み3件・待つ2件・解決1件$/,
    );
  });

  it('labels waiting badge by elapsed days', () => {
    expect(waitingBadgeLabel(3)).toBe('3日経過');
    expect(waitingBadgeLabel(0)).toBe('本日送付');
  });

  it('falls back next action when no audit queue', () => {
    const result = buildWorkspaceNextAction({
      ...COCKPIT,
      audit_queue: [],
      today_visits: [],
    });
    expect(result.actionLabel).toBe('今日の予定を確認する');
  });
});
