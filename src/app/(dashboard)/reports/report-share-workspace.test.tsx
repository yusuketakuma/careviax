// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import type { ReportsTodayWorkspaceResponse } from '@/types/reports-today-workspace';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { ReportShareWorkspace } from './report-share-workspace';
import {
  buildReportEvidence,
  buildHeaderMeta,
  waitingBadgeLabel,
} from './report-share-workspace.helpers';

setupDomTestEnv();

function localIso(year: number, monthIndex: number, day: number, hour: number, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute).toISOString();
}

const WAITING_REPLY_REQUEST_HREF =
  '/communications/requests?status=sent&patient_id=p_1&request_id=req_1&related_entity_type=tracing_report&related_entity_id=tracing%2F1%3Fx%3Dy%23frag';

function waitForRealtimeDebounce() {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

beforeEach(() => {
  vi.clearAllMocks();
  subscribeSharedRealtimeStreamMock.mockReturnValue(vi.fn());
  useUIStore.setState({ workspaceRailOpen: true });
});

const { routerPushMock, subscribeSharedRealtimeStreamMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  subscribeSharedRealtimeStreamMock: vi.fn(() => vi.fn()),
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

vi.mock('@/lib/realtime/shared-event-stream', () => ({
  subscribeSharedRealtimeStream: subscribeSharedRealtimeStreamMock,
}));

// Actual-backed spy: real encode/guard output for the hostile test, plus
// return-value delegation teeth for the post-generate router.push navigation.
vi.mock('@/lib/reports/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/reports/navigation')>();
  return { ...actual, buildReportHref: vi.fn(actual.buildReportHref) };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
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
      generation_targets: [],
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
      generation_targets: [
        { report_type: 'physician_report', label: '医師向け' },
        { report_type: 'care_manager_report', label: 'ケアマネ向け' },
      ],
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
      generation_targets: [{ report_type: 'facility_handoff', label: '施設向け' }],
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
      actions: [
        {
          label: '再送する',
          href: '/reports/rep_1?action=resend&delivery_id=delivery_waiting',
          kind: 'button',
        },
      ],
    },
    {
      id: 'wait_2',
      kind: 'inquiry',
      waiting_days: 2,
      title: '高橋 茂 様 — みどり医院への疑義照会',
      subtitle: null,
      actions: [
        { label: '依頼を確認', href: WAITING_REPLY_REQUEST_HREF, kind: 'button' },
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
        action: {
          label: '宛先確認・再送',
          href: '/reports/report_failed?action=resend&delivery_id=delivery_failed',
        },
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
  inbound_report_candidates: [
    {
      id: 'inbound-report-candidate-signal_report_1',
      signal_id: 'signal_report_1',
      inbound_event_id: 'event_report_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      patient_label: '田中 一郎 様',
      source_channel: 'fax',
      source_label: 'FAX',
      received_at: '2026-06-11T01:15:00.000Z',
      normalized_summary: '訪問看護から、食事量低下とふらつきの報告候補が届いています。',
      review_status: 'needs_review',
      action_status: 'not_linked',
      decision: 'needs_decision',
    },
  ],
  counts: {
    to_write: 3,
    waiting: 2,
    resolved: 1,
    created: 3,
    open_issues: 2,
    report_candidates: 1,
  },
  count_metadata: {
    to_write: {
      total_count: 3,
      visible_count: 3,
      hidden_count: 0,
      limit: null,
      truncated: false,
      count_basis: 'full_result',
    },
    waiting: {
      total_count: 2,
      visible_count: 2,
      hidden_count: 0,
      limit: 5,
      truncated: false,
      count_basis: 'database_total',
    },
    resolved: {
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      limit: 3,
      truncated: false,
      count_basis: 'database_total',
    },
    created: {
      total_count: 3,
      visible_count: 3,
      hidden_count: 0,
      limit: 12,
      truncated: false,
      count_basis: 'database_total',
    },
    open_issues: {
      total_count: 2,
      visible_count: 2,
      hidden_count: 0,
      limit: 12,
      truncated: false,
      count_basis: 'derived_visible_window',
    },
    report_candidates: {
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      limit: 12,
      truncated: false,
      count_basis: 'derived_visible_window',
    },
  },
  evidence: { template_count: 3, monthly_delivery_count: 14 },
  action_rail: {
    next_action: {
      actionLabel: '確認する',
      actionHref: '/reports/report_draft',
      description: '下書きのため、他職種への送付とPDF出力はできません。',
    },
    blocked_reasons: [
      {
        id: 'report_draft-draft-confirmation',
        label: '加藤 ミサ 様 — 薬剤師確認待ち',
        severity: 'critical',
        categoryLabel: '事務',
        actionLabel: '確認する',
        actionHref: '/reports/report_draft',
      },
      {
        id: 'report_draft-billing-context',
        label: '加藤 ミサ 様 — 保険・請求根拠未確定',
        severity: 'warning',
        categoryLabel: '事務',
        actionLabel: '根拠を確認',
        actionHref: '/reports/report_draft',
      },
    ],
    evidence: [
      {
        id: 'send-templates',
        label: '送付テンプレート',
        meta: '3種',
        href: '/admin/document-templates',
      },
      {
        id: 'delivery-history',
        label: '送付履歴',
        meta: '今月14件',
        href: '/communications/requests?status=sent',
      },
      {
        id: 'read-receipt',
        label: '既読確認',
        meta: 'ポータル連携',
        href: '/external?focus=shares',
      },
    ],
  },
};

function stubFetch(
  workspace: ReportsTodayWorkspaceResponse = TODAY_WORKSPACE,
  generatedReportId = 'rep_generated',
  generateFailure?: Response,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/care-reports/today-workspace')) {
      return new Response(JSON.stringify({ data: workspace }), { status: 200 });
    }
    if (url.includes('/api/dashboard/cockpit')) {
      throw new Error('reports workspace must not fetch /api/dashboard/cockpit');
    }
    if (url.includes('/api/care-reports/generate-from-visit')) {
      if (generateFailure) {
        return generateFailure;
      }
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
    if (url.includes('/api/communications/inbound/signals/')) {
      return new Response(
        JSON.stringify({
          data: {
            signal_id: decodeURIComponent(url.split('/').pop() ?? ''),
            inbound_event_id: 'event_report_1',
            review_status: 'accepted',
            action_status: 'not_linked',
            reviewed_at: '2026-06-11T01:20:00.000Z',
            review_task_closure_count: 1,
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubWorkspaceFailure(message: string) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/care-reports/today-workspace')) {
      return new Response(JSON.stringify({ message }), { status: 500 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWorkspace() {
  return render(<ReportShareWorkspace />, { wrapper: createQueryClientWrapper() });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  routerPushMock.mockClear();
});

describe('ReportShareWorkspace', () => {
  it('renders the 報告・共有 workspace: drafts table, waiting boxes and policy bar', async () => {
    stubFetch();
    renderWorkspace();

    expect(screen.getByRole('heading', { level: 1, name: '報告・共有' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('report-today-drafts')).toBeTruthy();
    });

    // ヘッダーメタ(書く/候補/待つ/解決の当日件数)
    expect(
      screen.getByText(/書く3件・候補1件・課題抽出内2件・作成済み3件・待つ2件・解決1件/),
    ).toBeTruthy();
    // テンプレート編集はアウトライン副操作
    expect(screen.getByTestId('report-edit-templates').textContent).toContain('テンプレートを編集');

    // 今日書く報告: 宛先と状態
    const drafts = screen.getByTestId('report-today-drafts');
    const workflow = screen.getByTestId('main-workflow-compact-nav');
    expect(
      Boolean(drafts.compareDocumentPosition(workflow) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(screen.getByText('未作成・下書き一覧 — 訪問完了後に選択して作成')).toBeTruthy();
    expect(screen.getAllByText('伊藤 キヨ 様')).not.toHaveLength(0);
    expect(screen.getAllByText('ケアマネ(中島様)')).not.toHaveLength(0);
    expect(screen.getAllByText('医師(山本先生)+ケアマネ')).not.toHaveLength(0);
    expect(screen.getAllByText('訪問後に下書き').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('未作成')).not.toHaveLength(0);
    // 危険区分メモは隠さない
    expect(screen.getAllByText('麻薬使用状況を含む')).not.toHaveLength(0);
    expect(screen.getAllByText('12名分を1通に集約')).not.toHaveLength(0);
    // メモがある行でも下書き/訪問導線を隠さない
    expect(
      screen.getAllByRole('link', { name: '→ 訪問へ' }).map((link) => link.getAttribute('href')),
    ).toEqual(['/visits', '/visits']);
    expect(
      screen.getAllByRole('button', { name: '田中 一郎 様 医師向けの下書きを自動作成' }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole('button', { name: '田中 一郎 様 ケアマネ向けの下書きを自動作成' }),
    ).toHaveLength(2);

    // 他職種受信の報告候補: normalized_summary だけを報告候補として表示する
    expect(screen.getByTestId('report-inbound-candidates')).toBeTruthy();
    expect(screen.getByText('他職種受信の報告候補')).toBeTruthy();
    expect(
      screen.getByText('訪問看護から、食事量低下とふらつきの報告候補が届いています。'),
    ).toBeTruthy();
    expect(screen.getByText('FAX / 受信 06/11 10:15')).toBeTruthy();
    expect(screen.getByRole('button', { name: '田中 一郎 様 報告書に含める' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '田中 一郎 様 申し送りのみ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '田中 一郎 様 内部記録のみ' })).toBeTruthy();

    // 残課題 / 作成済み報告書: 他職種報告済みかどうかと送信日時を表示する
    expect(screen.getByTestId('report-open-issues')).toBeTruthy();
    expect(screen.getAllByText('加藤 ミサ 様 — 薬剤師確認待ち').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText('加藤 ミサ 様 — 保険・請求根拠未確定').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('report-created-list')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '作成済み報告書' })).toBeTruthy();

    // Slice1: 即時対応優先(guidelines §68-76)。返信待ち(=止まっている)を残課題・作成済みより前に出す。
    const waiting = screen.getAllByTestId('report-waiting-reply')[0];
    const issues = screen.getByTestId('report-open-issues');
    const created = screen.getByTestId('report-created-list');
    expect(waiting.compareDocumentPosition(issues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      waiting.compareDocumentPosition(created) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole('link', { name: '田中 一郎 様' })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/patients/patient_1', '/patients/patient_1', '/patients/patient_1']);
    expect(
      screen.getAllByText((text) => text.includes('医師への報告 / 主治医への服薬状況報告')),
    ).not.toHaveLength(0);
    expect(screen.getAllByText('他職種へ報告済み')).not.toHaveLength(0);
    expect(screen.getAllByText(/06\/11 11:10 \/ 山田 太郎 \/ FAX/)).not.toHaveLength(0);
    expect(screen.getAllByText('他職種未報告')).not.toHaveLength(0);
    expect(screen.getAllByText('送付失敗').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('メール / やまもと内科 / 再送1回')).not.toHaveLength(0);
    expect(screen.getAllByText('メール送信に失敗しました')).not.toHaveLength(0);
    expect(
      screen
        .getAllByRole('link', { name: '宛先確認・再送' })
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/reports/report_failed?action=resend&delivery_id=delivery_failed',
      '/reports/report_failed?action=resend&delivery_id=delivery_failed',
    ]);
    expect(screen.queryByRole('button', { name: /CSV出力/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '印刷' })).toBeNull();

    // 返信待ち / 今日解決した待ち
    expect(screen.getByText('返信待ち')).toBeTruthy();
    expect(screen.getByText('3日経過')).toBeTruthy();
    expect(screen.getByText('再送する')).toBeTruthy();
    expect(screen.getByRole('link', { name: '再送する' }).getAttribute('href')).toBe(
      '/reports/rep_1?action=resend&delivery_id=delivery_waiting',
    );
    expect(screen.getByRole('link', { name: '依頼を確認' }).getAttribute('href')).toBe(
      WAITING_REPLY_REQUEST_HREF,
    );
    expect(screen.getByText('今日解決した待ち')).toBeTruthy();
    expect(screen.getByText(/回答受領/)).toBeTruthy();
    expect(screen.getByText('佐々木 ハル 様 — 残薬照会(やまもと内科)')).toBeTruthy();

    // テンプレート方針バー(実施→観察→提案)
    expect(screen.getByTestId('report-template-policy-bar').textContent).toContain(
      '実施したこと → 観察したこと → 提案',
    );
  });

  it('updates inbound report candidate decisions without calling report send, PDF, or share APIs', async () => {
    const workspace = JSON.parse(JSON.stringify(TODAY_WORKSPACE)) as ReportsTodayWorkspaceResponse;
    Object.assign(workspace.inbound_report_candidates[0]!, {
      raw_text: '原文: 湿布 残り4枚',
      sender_name: '訪問看護師A',
      sender_contact: '090-1234-5678',
      external_url: 'https://mcs.example/secret',
      attachment_count: 1,
    });
    const fetchMock = stubFetch(workspace);
    renderWorkspace();

    await screen.findByTestId('report-inbound-candidates');
    expect(screen.queryByText(/原文/)).toBeNull();
    expect(screen.queryByText(/湿布/)).toBeNull();
    expect(screen.queryByText(/訪問看護師A/)).toBeNull();
    expect(screen.queryByText(/090-1234-5678/)).toBeNull();
    expect(screen.queryByText(/mcs\.example/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '田中 一郎 様 報告書に含める' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/communications/inbound/signals/signal_report_1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
          body: JSON.stringify({ action: 'include_in_report' }),
        },
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '田中 一郎 様 申し送りのみ' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/communications/inbound/signals/signal_report_1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
          body: JSON.stringify({ action: 'handoff_only' }),
        },
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '田中 一郎 様 内部記録のみ' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/communications/inbound/signals/signal_report_1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
          body: JSON.stringify({ action: 'internal_record_only' }),
        },
      );
    });

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes('/api/care-reports/send'))).toBe(false);
    expect(urls.some((url) => url.includes('/api/care-reports/pdf'))).toBe(false);
    expect(urls.some((url) => url.includes('/api/care-reports/share'))).toBe(false);
    expect(urls.some((url) => url.includes('/api/dashboard/cockpit'))).toBe(false);
    expect(
      urls.filter((url) => url.includes('/api/care-reports/today-workspace')).length,
    ).toBeGreaterThanOrEqual(2);
    expect(toast.success).toHaveBeenCalledWith('報告候補として採用しました');
  });

  it('promotes the action rail into the fold ahead of the main content in DOM order', async () => {
    stubFetch();
    renderWorkspace();

    const railSlot = await screen.findByTestId('report-action-rail-slot');
    const drafts = await screen.findByTestId('report-today-drafts');
    // CSS order ではなく DOM/フォーカス/SR 順でも rail を本文より先に出す
    // (視覚順=論理順を一致、WCAG 2.4.3/1.3.2)。
    expect(
      Boolean(railSlot.compareDocumentPosition(drafts) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    // 補助領域はランドマーク(aside)として公開し、デスクトップは grid 配置で右 sticky 列へ。
    expect(railSlot.tagName).toBe('ASIDE');
    expect(railSlot.className).toContain('lg:sticky');
    expect(railSlot.className).toContain('lg:col-start-2');
  });

  it('renders resolved-today rows as left-border accents, not full state-color fills', async () => {
    stubFetch();
    renderWorkspace();

    const rows = await screen.findAllByTestId('report-resolved-row');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // 状態色の塗り面積は左ボーダーに最小化(全面塗り bg-state-done/10 を撤去)。
      expect(row.className).toContain('border-l-state-done');
      expect(row.className).not.toContain('bg-state-done/10');
    }
  });

  it('labels limited workspace counts as visible plus hidden rows', async () => {
    const workspace = JSON.parse(JSON.stringify(TODAY_WORKSPACE)) as ReportsTodayWorkspaceResponse;
    workspace.counts = {
      ...workspace.counts,
      waiting: 6,
      resolved: 4,
      created: 12,
      open_issues: 5,
    };
    workspace.count_metadata = {
      ...workspace.count_metadata,
      waiting: {
        ...workspace.count_metadata.waiting,
        total_count: 6,
        visible_count: workspace.waiting_replies.length,
        hidden_count: 4,
        truncated: true,
      },
      resolved: {
        ...workspace.count_metadata.resolved,
        total_count: 4,
        visible_count: workspace.resolved_today.length,
        hidden_count: 3,
        truncated: true,
      },
      created: {
        ...workspace.count_metadata.created,
        total_count: 12,
        visible_count: workspace.created_reports.length,
        hidden_count: 9,
        truncated: true,
      },
      open_issues: {
        ...workspace.count_metadata.open_issues,
        total_count: 5,
        visible_count: workspace.open_issues.length,
        hidden_count: 3,
        truncated: true,
      },
    };

    stubFetch(workspace);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('report-waiting-box')).toBeTruthy();
    });
    expect(screen.getByText('先頭2件 / 他4件')).toBeTruthy();
    expect(screen.getByText('先頭1件 / 他3件')).toBeTruthy();
    expect(screen.getByText('先頭3件 / 他9件')).toBeTruthy();
    expect(screen.getByText('抽出内先頭2件 / 他3件')).toBeTruthy();
    expect(
      screen.getByText(/書く3件・候補1件・課題抽出内5件・作成済み12件・待つ6件・解決4件/),
    ).toBeTruthy();
  });

  it('shows the created-reports empty state only after a successful empty response', async () => {
    const workspace = JSON.parse(JSON.stringify(TODAY_WORKSPACE)) as ReportsTodayWorkspaceResponse;
    workspace.created_reports = [];
    workspace.counts = { ...workspace.counts, created: 0 };
    workspace.count_metadata = {
      ...workspace.count_metadata,
      created: {
        ...workspace.count_metadata.created,
        total_count: 0,
        visible_count: 0,
        hidden_count: 0,
        truncated: false,
      },
    };

    stubFetch(workspace);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('report-created-list')).toBeTruthy();
    });
    expect(screen.getByText('作成済み報告書はありません。')).toBeTruthy();
    expect(screen.queryByText('報告・共有を表示できません')).toBeNull();
  });

  it('shows the drafts empty state only after a successful empty response', async () => {
    const workspace = JSON.parse(JSON.stringify(TODAY_WORKSPACE)) as ReportsTodayWorkspaceResponse;
    workspace.draft_rows = [];
    workspace.counts = { ...workspace.counts, to_write: 0 };
    workspace.count_metadata = {
      ...workspace.count_metadata,
      to_write: {
        ...workspace.count_metadata.to_write,
        total_count: 0,
        visible_count: 0,
        hidden_count: 0,
        truncated: false,
      },
    };

    stubFetch(workspace);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('report-today-drafts')).toBeTruthy();
    });
    expect(
      screen.getByText(
        '本日の訪問予定はありません。訪問が完了すると、ここに報告の下書きが並びます。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('報告・共有を表示できません')).toBeNull();
  });

  it('does not show the created-reports empty state when the workspace query fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/care-reports/today-workspace')) {
          return new Response(JSON.stringify({ error: 'workspace unavailable' }), {
            status: 500,
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWorkspace();

    expect(await screen.findByText('報告・共有を表示できません')).toBeTruthy();
    expect(screen.queryByTestId('report-today-drafts')).toBeNull();
    expect(
      screen.queryByText(
        '本日の訪問予定はありません。訪問が完了すると、ここに報告の下書きが並びます。',
      ),
    ).toBeNull();
    expect(screen.queryByTestId('report-created-list')).toBeNull();
    expect(screen.queryByText('作成済み報告書はありません。')).toBeNull();
  });

  it('refreshes only for report-relevant realtime events', async () => {
    const fetchMock = stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('report-today-drafts')).toBeTruthy();
    });
    fetchMock.mockClear();

    const subscriptionCalls = subscribeSharedRealtimeStreamMock.mock.calls as unknown as Array<
      [{ onEvent?: (event: unknown) => void }]
    >;
    const subscription = subscriptionCalls[0]?.[0];
    expect(subscription?.onEvent).toBeTypeOf('function');
    if (!subscription?.onEvent) {
      throw new Error('Report workspace realtime subscription was not established');
    }

    await act(async () => {
      subscription.onEvent?.({ type: 'notification_created', notification_id: 'notification_1' });
      await waitForRealtimeDebounce();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      subscription.onEvent?.({ type: 'workflow_refresh', source: 'visit_schedules_update' });
      await waitForRealtimeDebounce();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      subscription.onEvent?.({ type: 'report_delivery_update', report_id: 'rep_1' });
      await waitForRealtimeDebounce();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/today-workspace', {
        headers: { 'x-org-id': 'org_1' },
      });
    });
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

  it('renders @db.Time visit clocks without converting ISO offsets', async () => {
    const workspace = JSON.parse(JSON.stringify(TODAY_WORKSPACE)) as ReportsTodayWorkspaceResponse;
    workspace.draft_rows = [
      {
        ...workspace.draft_rows[0],
        id: 'offset-row',
        time_start: '1970-01-01T09:00:00.000-08:00',
        patient_label: '時刻固定 様',
      },
    ];
    workspace.counts = { ...workspace.counts, to_write: 1 };

    stubFetch(workspace);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('report-today-drafts')).toBeTruthy();
    });
    expect(screen.getAllByText('09:00')).not.toHaveLength(0);
    expect(screen.queryAllByText('18:00')).toHaveLength(0);
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
    workspace.inbound_report_candidates = [];
    workspace.counts = { ...workspace.counts, created: 2, report_candidates: 0 };
    workspace.count_metadata = {
      ...workspace.count_metadata,
      report_candidates: {
        ...workspace.count_metadata.report_candidates,
        total_count: 0,
        visible_count: 0,
      },
    };

    stubFetch(workspace);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('report-created-list')).toBeTruthy();
    });

    const linkedPatientHrefs = screen
      .getAllByRole('link', { name: '田中 一郎 様' })
      .map((link) => link.getAttribute('href'));
    expect(linkedPatientHrefs).toEqual([
      `/patients/${encodeURIComponent('../settings?x=1#y')}`,
      `/patients/${encodeURIComponent('../settings?x=1#y')}`,
    ]);
    for (const href of linkedPatientHrefs) {
      expect(href).not.toContain('/settings');
      expect(href).not.toContain('?x=1');
      expect(href).not.toContain('#y');
    }

    for (const unassignedPatient of screen.getAllByText('患者未設定')) {
      expect(unassignedPatient.closest('a')).toBeNull();
    }
  });

  it('uses the shared buildPatientHref return value for created-report patient links', async () => {
    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation((id: string) => `/patients/__sentinel_${id}__`);
    vi.mocked(buildPatientHref).mockClear();
    const workspace = JSON.parse(JSON.stringify(TODAY_WORKSPACE)) as ReportsTodayWorkspaceResponse;
    workspace.inbound_report_candidates = [];
    workspace.counts = { ...workspace.counts, report_candidates: 0 };
    workspace.count_metadata = {
      ...workspace.count_metadata,
      report_candidates: {
        ...workspace.count_metadata.report_candidates,
        total_count: 0,
        visible_count: 0,
      },
    };
    try {
      stubFetch(workspace);
      renderWorkspace();

      await screen.findAllByRole('link', { name: '田中 一郎 様' });
      expect(
        screen
          .getAllByRole('link', { name: '田中 一郎 様' })
          .map((link) => link.getAttribute('href')),
      ).toEqual(['/patients/__sentinel_patient_1__', '/patients/__sentinel_patient_1__']);
      expect(vi.mocked(buildPatientHref).mock.calls).toEqual([
        ['patient_1'],
        ['patient_2'],
        ['patient_3'],
        ['patient_1'],
        ['patient_2'],
        ['patient_3'],
      ]);
    } finally {
      if (realImpl) {
        vi.mocked(buildPatientHref).mockImplementation(realImpl);
      }
    }
  });

  it('creates a report draft from a selected not-created row and opens the draft', async () => {
    const fetchMock = stubFetch();
    renderWorkspace();

    const generateButton = (
      await screen.findAllByRole('button', {
        name: '田中 一郎 様 ケアマネ向けの下書きを自動作成',
      })
    )[0];
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/generate-from-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
        body: JSON.stringify({
          visit_record_id: 'vr_2',
          expected_visit_record_updated_at: '2026-06-11T04:45:00.000Z',
          report_type: 'care_manager_report',
        }),
      });
    });
    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith('/reports/rep_generated');
    });
  });

  it('only disables the draft generation target that is currently pending', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/care-reports/today-workspace')) {
        return new Response(JSON.stringify({ data: TODAY_WORKSPACE }), { status: 200 });
      }
      if (url.includes('/api/care-reports/generate-from-visit')) {
        return new Promise<Response>(() => undefined);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace();

    const physicianButtons = await screen.findAllByRole('button', {
      name: '田中 一郎 様 医師向けの下書きを自動作成',
    });
    fireEvent.click(physicianButtons[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/generate-from-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
        body: JSON.stringify({
          visit_record_id: 'vr_2',
          expected_visit_record_updated_at: '2026-06-11T04:45:00.000Z',
          report_type: 'physician_report',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText('作成中...').length).toBeGreaterThan(0);
    });

    const updatedCareManagerButtons = screen.getAllByRole('button', {
      name: '田中 一郎 様 ケアマネ向けの下書きを自動作成',
    });
    expect((updatedCareManagerButtons[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps server messages when draft generation fails', async () => {
    stubFetch(
      TODAY_WORKSPACE,
      'rep_generated',
      new Response(JSON.stringify({ message: '訪問記録が更新されています' }), { status: 409 }),
    );
    renderWorkspace();

    fireEvent.click(
      (
        await screen.findAllByRole('button', {
          name: '田中 一郎 様 ケアマネ向けの下書きを自動作成',
        })
      )[0],
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('訪問記録が更新されています');
    });
  });

  it('falls back when draft generation fails without a server message', async () => {
    stubFetch(TODAY_WORKSPACE, 'rep_generated', new Response('server error', { status: 500 }));
    renderWorkspace();

    fireEvent.click(
      (
        await screen.findAllByRole('button', {
          name: '田中 一郎 様 医師向けの下書きを自動作成',
        })
      )[0],
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('下書きの作成に失敗しました');
    });
  });

  it('preserves the physician draft generation optimistic-lock payload', async () => {
    const fetchMock = stubFetch();
    renderWorkspace();

    const generateButton = (
      await screen.findAllByRole('button', {
        name: '田中 一郎 様 医師向けの下書きを自動作成',
      })
    )[0];
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/generate-from-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
        body: JSON.stringify({
          visit_record_id: 'vr_2',
          expected_visit_record_updated_at: '2026-06-11T04:45:00.000Z',
          report_type: 'physician_report',
        }),
      });
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
        (
          await screen.findAllByRole('button', {
            name: '田中 一郎 様 医師向けの下書きを自動作成',
          })
        )[0],
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
      (
        await screen.findAllByRole('button', {
          name: '田中 一郎 様 医師向けの下書きを自動作成',
        })
      )[0],
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

  it('does not render raw workspace fetch errors in the action rail or main segment error', async () => {
    const fetchMock = stubWorkspaceFailure(
      'DB timeout /api/care-reports/today-workspace patient_name=山田 storage_key=s3://phi',
    );
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('報告・共有を表示できません').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/patient_name=山田/)).toBeNull();
    expect(screen.queryByText(/storage_key/)).toBeNull();
    expect(screen.queryByText(/s3:\/\/phi/)).toBeNull();
    expect(screen.queryByText(/\/api\/care-reports\/today-workspace/)).toBeNull();
    expect(screen.queryByText('作成済み報告書はありません。')).toBeNull();
    expect(screen.queryByTestId('report-today-drafts')).toBeNull();
    expect(screen.queryByTestId('report-created-list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes('/api/care-reports/today-workspace'),
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders the report workspace action rail without refetching dashboard cockpit', async () => {
    const fetchMock = stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-action-rail')).toBeTruthy();
    });

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/dashboard/cockpit')),
    ).toBe(false);

    // 次にやること: report BFF の最優先 open issue を主操作にする
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('link', { name: '確認する' })
          .some((link) => link.getAttribute('href') === '/reports/report_draft'),
      ).toBe(true);
    });
    expect(
      screen.getAllByText('下書きのため、他職種への送付とPDF出力はできません。').length,
    ).toBeGreaterThanOrEqual(1);

    // 止まっている理由(カテゴリ+経過+個別アクション)
    expect(screen.getByText('止まっている理由')).toBeTruthy();
    expect(screen.getAllByText('加藤 ミサ 様 — 薬剤師確認待ち').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText('加藤 ミサ 様 — 保険・請求根拠未確定').length,
    ).toBeGreaterThanOrEqual(1);

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
      /^6\/11\(木\) — 書く3件・候補1件・課題抽出内2件・作成済み3件・待つ2件・解決1件$/,
    );
  });

  it('does not mark open issue counts as extracted when the API supplies a database total', () => {
    const countMetadata: ReportsTodayWorkspaceResponse['count_metadata'] = {
      ...TODAY_WORKSPACE.count_metadata,
      open_issues: {
        ...TODAY_WORKSPACE.count_metadata.open_issues,
        count_basis: 'database_total',
      },
    };

    expect(buildHeaderMeta(new Date(2026, 5, 11), TODAY_WORKSPACE.counts, countMetadata)).toMatch(
      /^6\/11\(木\) — 書く3件・候補1件・課題2件・作成済み3件・待つ2件・解決1件$/,
    );
  });

  it('focuses read receipt evidence on the external share queue', () => {
    expect(buildReportEvidence(TODAY_WORKSPACE)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'read-receipt',
          href: '/external?focus=shares',
        }),
      ]),
    );
  });

  it('labels waiting badge by elapsed days', () => {
    expect(waitingBadgeLabel(3)).toBe('3日経過');
    expect(waitingBadgeLabel(0)).toBe('本日送付');
  });
});
