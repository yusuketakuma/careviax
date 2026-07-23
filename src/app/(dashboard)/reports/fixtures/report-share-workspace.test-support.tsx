import { render } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import type {
  ReportInboundCandidateAction,
  ReportsTodayWorkspaceResponse,
} from '@/types/reports-today-workspace';
import { reportsTodayWorkspaceResponseSchema } from '@/lib/reports/today-workspace-response-schema';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { ReportShareWorkspace } from '../report-share-workspace';

setupDomTestEnv();

function japanLocalIso(year: number, monthIndex: number, day: number, hour: number, minute = 0) {
  return new Date(Date.UTC(year, monthIndex, day, hour - 9, minute)).toISOString();
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
      last_sent_at: japanLocalIso(2026, 5, 11, 11, 10),
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

it('keeps the workspace fixture aligned with the strict provider contract', () => {
  const result = reportsTodayWorkspaceResponseSchema.safeParse({ data: TODAY_WORKSPACE });
  expect(result.success, result.success ? undefined : result.error.toString()).toBe(true);
});

function stubFetch(
  workspace: ReportsTodayWorkspaceResponse = TODAY_WORKSPACE,
  generatedReportId = 'rep_generated',
  generateFailure?: Response,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
      const action = JSON.parse(String(init?.body)) as { action: ReportInboundCandidateAction };
      const include = action.action === 'include_in_report';
      return new Response(
        JSON.stringify({
          data: {
            signal_id: decodeURIComponent(url.split('/').pop() ?? ''),
            inbound_event_id: 'event_report_1',
            review_status: include ? 'accepted' : 'record_only',
            action_status: include ? 'not_linked' : 'ignored',
            reviewed_at: '2026-06-11T01:20:00.000Z',
            review_task_closure_count: 1,
          },
          meta: { generated_at: '2026-06-11T01:20:00.000Z' },
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

function renderWorkspace(queryClient: QueryClient = createTestQueryClient()) {
  return render(<ReportShareWorkspace />, { wrapper: createQueryClientWrapper(queryClient) });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  routerPushMock.mockClear();
});

export function getReportShareWorkspaceTestSupport() {
  return {
    buildPatientHref,
    buildReportHref,
    createTestQueryClient,
    renderWorkspace,
    routerPushMock,
    stubFetch,
    stubWorkspaceFailure,
    subscribeSharedRealtimeStreamMock,
    toast,
    TODAY_WORKSPACE,
    WAITING_REPLY_REQUEST_HREF,
    waitForRealtimeDebounce,
  };
}
