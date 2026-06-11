// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { DispenseWorkbenchData } from './dispense-workbench.shared';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));
vi.mock('@/lib/hooks/use-realtime-query', () => ({ useRealtimeQuery: useRealtimeQueryMock }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { DispenseWorkbench } from './dispense-workbench';

setupDomTestEnv();

function buildQueueRow(args: {
  id: string;
  name: string;
  overallStatus?: string;
  priority?: string;
}) {
  return {
    id: args.id,
    priority: args.priority ?? 'normal',
    due_date: null,
    status: 'pending',
    cycle: {
      id: `cycle-${args.id}`,
      overall_status: args.overallStatus ?? 'ready_to_dispense',
      case_: { patient: { id: `patient-${args.id}`, name: args.name } },
    },
  };
}

const QUEUE_ROWS = [
  buildQueueRow({ id: 'task-sasaki', name: '佐々木 ハル', overallStatus: 'inquiry_resolved' }),
  buildQueueRow({ id: 'task-watanabe', name: '渡辺 フミ' }),
  buildQueueRow({ id: 'task-matsumoto', name: '松本 トヨ' }),
  buildQueueRow({ id: 'task-kobayashi', name: '小林 勝' }),
  ...Array.from({ length: 5 }, (_, index) =>
    buildQueueRow({ id: `task-rest-${index}`, name: `患者 ${index}` }),
  ),
];

const WORKBENCH: DispenseWorkbenchData = {
  task: { id: 'task-sasaki', status: 'pending', priority: 'normal', due_date: null },
  cycle: { id: 'cycle-task-sasaki', overall_status: 'inquiry_resolved' },
  patient: { id: 'patient-task-sasaki', name: '佐々木 ハル' },
  intake: { id: 'intake-1', prescribed_date: '2026-06-08' },
  previous_intake: { prescribed_date: '2026-05-14' },
  safety: {
    allergy: 'なし(確認済 6/1)',
    renal: 'eGFR 41 — 用量に注意',
    handling_tags: [],
    swallowing: null,
    cautions: [],
  },
  comparison: [
    {
      key: 'line-famotidine',
      drug_name: 'ファモチジン',
      previous_label: '20mg 朝夕',
      current_label: '10mg 朝夕',
      change_type: 'dose_changed',
      direction: 'decrease',
      inquiry_origin: true,
    },
    {
      key: 'line-magmitt',
      drug_name: 'マグミット 330mg',
      previous_label: '毎食後',
      current_label: '毎食後',
      change_type: null,
      direction: null,
      inquiry_origin: false,
    },
    {
      key: 'line-atorvastatin',
      drug_name: 'アトルバスタチン 5mg',
      previous_label: '朝1錠',
      current_label: '朝1錠',
      change_type: null,
      direction: null,
      inquiry_origin: false,
    },
  ],
  count_rows: [
    {
      line_id: 'line-famotidine',
      result_id: null,
      drug_name: 'ファモチジン',
      tags: [],
      is_narcotic: false,
      prescribed_label: '28錠',
      prescribed_quantity: 28,
      dispensed_label: null,
      dispensed_quantity: null,
      unit: '錠',
    },
  ],
  dispenser: null,
  auditor: { id: 'user-yamada', name: '山田 花子' },
  is_self_audit: false,
  has_narcotic: false,
  visit_time_label: null,
  resolved_inquiry: {
    inquired_at: '2026-06-11T07:31:00',
    resolved_at: '2026-06-11T09:31:00',
    institution: 'やまもと内科',
    change_detail: '減量',
  },
  team_audit_total: 24,
  stock_check_date_label: '6/9',
};

const COCKPIT = {
  generated_at: '2026-06-11T09:42:00',
  cycle_status_counts: {},
  audit_pending_count: 6,
  narcotic_audit_count: 1,
  audit_queue: [
    {
      task_id: 'task-tanaka',
      cycle_id: 'cycle-tanaka',
      patient_name: '田中 一郎',
      priority: 'urgent',
      due_at: '2026-06-11T12:00:00',
      intake_id: 'intake-tanaka',
      prescribed_date: '2026-06-08',
      handling_tags: ['narcotic'],
      has_narcotic: true,
      waiting_since: '2026-06-11T09:30:00',
    },
  ],
  today_visits: [
    {
      id: 'visit-tanaka',
      patient_name: '田中 一郎',
      visit_type: 'regular',
      schedule_status: 'planned',
      time_start: '2026-06-11T14:00:00',
      time_end: '2026-06-11T14:30:00',
      facility_batch_id: null,
    },
  ],
  blocked_reasons: [
    {
      id: 'blocked-consent',
      label: 'ご家族の同意待ち(新規契約)',
      severity: 'critical' as const,
      category: '患者',
      age_minutes: 1500,
      action_label: '再連絡する →',
      action_href: '/communications/requests',
    },
    {
      id: 'blocked-delivery',
      label: '送付先の確認(やまもと内科)',
      severity: 'warning' as const,
      category: '事務',
      age_minutes: 30,
      action_label: '状況を見る →',
      action_href: '/admin/contact-profiles',
    },
  ],
  carryover_count: 0,
};

describe('DispenseWorkbench', () => {
  const mutateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: mutateMock, isPending: false });
    useRealtimeQueryMock.mockReturnValue({ data: { data: QUEUE_ROWS }, isLoading: false });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'dispense-workbench') {
        return { data: WORKBENCH, isLoading: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: COCKPIT, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });
  });

  it('3ペイン構成(キュー / いまの1件 / 右レール)を新デザインの文言で描画する', () => {
    render(<DispenseWorkbench />);

    // ページヘッダー
    expect(screen.getByRole('heading', { name: '調剤' })).toBeTruthy();
    expect(screen.getByText(/1件集中・割り込み防護/)).toBeTruthy();

    // 左: 調剤キュー(9件 / 再開バッジ / 集約行「ほか6件」)
    expect(screen.getByText('調剤キュー')).toBeTruthy();
    expect(screen.getByText('9件')).toBeTruthy();
    expect(screen.getByText('再開')).toBeTruthy();
    expect(screen.getByText('佐々木 ハル 様')).toBeTruthy();
    expect(screen.getByText('照会回答の反映 — 用量変更あり')).toBeTruthy();
    expect(screen.getAllByText('定期・変更なし').length).toBeGreaterThan(0);
    expect(screen.getByText('ほか6件')).toBeTruthy();

    // 中央: いまの1件
    expect(screen.getByText('いまの1件 — 佐々木 ハル 様')).toBeTruthy();
    expect(screen.getByText('2時間止まっていた件 — 09:31に解除')).toBeTruthy();
    expect(screen.getByText('割り込み防護 ON')).toBeTruthy();

    // セーフティボード
    expect(screen.getByTestId('safety-board')).toBeTruthy();
    expect(screen.getByText('eGFR 41 — 用量に注意')).toBeTruthy();
    expect(screen.getByText('なし(確認済 6/1)')).toBeTruthy();

    // 処方比較(前回 / 今回 / 差)
    expect(screen.getByText('前回')).toBeTruthy();
    expect(screen.getByText('今回')).toBeTruthy();
    expect(screen.getByText('20mg 朝夕')).toBeTruthy();
    expect(screen.getByText('10mg 朝夕')).toBeTruthy();
    expect(screen.getByText('減量')).toBeTruthy();
    expect(screen.getByText('照会回答による変更')).toBeTruthy();

    // 確認チェックリスト
    expect(screen.getByText('変更点を口頭読み上げで確認(減量: ファモチジン)')).toBeTruthy();
    expect(screen.getByText('腎機能と用量の整合を確認')).toBeTruthy();
    expect(screen.getByText('計数 — 1回目(自分)')).toBeTruthy();
    expect(screen.getByText('一包化の印字(氏名・用法・日付)を確認')).toBeTruthy();

    // アクション行(主操作は 1 つ)+ 注記バー
    expect(screen.getByTestId('dispense-complete-button').textContent).toContain(
      '調剤を完了して監査へ送る',
    );
    expect(screen.getByRole('button', { name: '中断(理由必須)' })).toBeTruthy();
    expect(screen.getByText('→ カードへ')).toBeTruthy();
    expect(screen.getByTestId('interrupt-guard-note').textContent).toContain(
      '割り込み防護: この1件が終わるまで、新しい依頼は通知のみで画面は切り替わりません。緊急(赤)だけは例外です。',
    );

    // 右レール: 次にやること / 止まっている理由 / 根拠・記録
    expect(screen.getByText('麻薬監査を開始 — 12:00期限')).toBeTruthy();
    expect(
      screen.getByText('14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。'),
    ).toBeTruthy();
    expect(screen.getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(screen.getByText('1日')).toBeTruthy();
    expect(screen.getByText('照会回答')).toBeTruthy();
    expect(screen.getByText('09:31 やまもと内科')).toBeTruthy();
    expect(screen.getByText('前回の調剤記録')).toBeTruthy();
    expect(screen.getByText('5/14')).toBeTruthy();
  });

  it('チェックリスト未完了のまま主操作を押すと警告し、送信しない', () => {
    render(<DispenseWorkbench />);

    fireEvent.click(screen.getByTestId('dispense-complete-button'));

    expect(toastMock.warning).toHaveBeenCalledWith('確認チェックリストを全て確認してください');
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('チェックリスト 4 項目を確認すると主操作で送信できる', () => {
    render(<DispenseWorkbench />);

    for (const checkbox of screen.getAllByRole('checkbox')) {
      fireEvent.click(checkbox);
    }
    fireEvent.click(screen.getByTestId('dispense-complete-button'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
  });
});
