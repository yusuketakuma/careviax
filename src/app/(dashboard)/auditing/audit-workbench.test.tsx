// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { DispenseWorkbenchData } from '@/app/(dashboard)/dispense/dispense-workbench.shared';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
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
vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock,
}));

import { AuditWorkbench } from './audit-workbench';

setupDomTestEnv();

function buildQueueRow(args: {
  id: string;
  name: string;
  dueDate?: string | null;
  facilityLabel?: string | null;
  narcotic?: boolean;
  priority?: string;
}) {
  return {
    id: args.id,
    priority: args.priority ?? 'normal',
    due_date: args.dueDate ?? null,
    facility_label: args.facilityLabel ?? null,
    is_overdue: false,
    cycle: {
      id: `cycle-${args.id}`,
      case_: { patient: { id: `patient-${args.id}`, name: args.name } },
      prescription_intakes: [
        {
          id: `intake-${args.id}`,
          lines: [
            {
              id: `line-${args.id}`,
              packaging_instruction_tags: args.narcotic ? ['narcotic'] : [],
            },
          ],
        },
      ],
    },
    results: [
      {
        id: `result-${args.id}`,
        dispensed_at: '2026-06-11T09:30:00',
        line: {
          id: `line-${args.id}`,
          packaging_instruction_tags: args.narcotic ? ['narcotic'] : [],
        },
      },
    ],
  };
}

const QUEUE_ROWS = [
  buildQueueRow({
    id: 'task-tanaka',
    name: '田中 一郎',
    dueDate: '2026-06-11T12:00:00',
    narcotic: true,
    priority: 'urgent',
  }),
  buildQueueRow({ id: 'task-ito', name: '伊藤 キヨ' }),
  buildQueueRow({ id: 'task-yamaguchi', name: '山口 清', facilityLabel: '施設GH' }),
  ...Array.from({ length: 3 }, (_, index) =>
    buildQueueRow({ id: `task-rest-${index}`, name: `患者 ${index}` }),
  ),
];

const WORKBENCH: DispenseWorkbenchData = {
  task: {
    id: 'task-tanaka',
    status: 'completed',
    priority: 'urgent',
    due_date: '2026-06-11T12:00:00',
  },
  cycle: { id: 'cycle-task-tanaka', overall_status: 'dispensed' },
  patient: { id: 'patient-task-tanaka', name: '田中 一郎' },
  intake: { id: 'cmnhdemointk002amq0500', prescribed_date: '2024-06-08' },
  previous_intake: { prescribed_date: '2024-05-11' },
  safety: {
    allergy: null,
    renal: null,
    handling_tags: ['cold_storage'],
    swallowing: null,
    cautions: [],
  },
  comparison: [
    {
      key: 'line-oxycodone',
      drug_name: 'オキシコドン 5mg',
      previous_label: null,
      current_label: '5mg 追加',
      change_type: 'added',
      direction: null,
      inquiry_origin: true,
    },
  ],
  count_rows: [
    {
      line_id: 'line-oxycodone',
      result_id: 'result-1',
      line_number: 1,
      drug_name: 'オキシコドン 5mg',
      dose: '1錠',
      frequency: '疼痛時',
      route: '内服',
      tags: ['narcotic'],
      is_narcotic: true,
      prescribed_label: '14錠',
      prescribed_quantity: 14,
      days: 14,
      dispensed_label: '14錠',
      dispensed_quantity: 14,
      unit: '錠',
      dispensing_method: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_group_id: null,
    },
    {
      line_id: 'line-amlodipine',
      result_id: 'result-2',
      line_number: 2,
      drug_name: 'アムロジピン 5mg',
      dose: '1錠',
      frequency: '朝食後',
      route: '内服',
      tags: [],
      is_narcotic: false,
      prescribed_label: '28錠',
      prescribed_quantity: 28,
      days: 28,
      dispensed_label: '28錠',
      dispensed_quantity: 28,
      unit: '錠',
      dispensing_method: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_group_id: null,
    },
    {
      line_id: 'line-lansoprazole',
      result_id: 'result-3',
      line_number: 3,
      drug_name: 'ランソプラゾール 15mg',
      dose: '1錠',
      frequency: '朝食前',
      route: '内服',
      tags: [],
      is_narcotic: false,
      prescribed_label: '28錠',
      prescribed_quantity: 28,
      days: 28,
      dispensed_label: '28錠',
      dispensed_quantity: 28,
      unit: '錠',
      dispensing_method: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_group_id: null,
    },
    {
      line_id: 'line-insulin',
      result_id: 'result-4',
      line_number: 4,
      drug_name: 'インスリン グラルギン',
      dose: '1本',
      frequency: '眠前',
      route: '注射',
      tags: ['cold_storage'],
      is_narcotic: false,
      prescribed_label: '1本',
      prescribed_quantity: 1,
      days: 1,
      dispensed_label: '1本',
      dispensed_quantity: 1,
      unit: '本',
      dispensing_method: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_group_id: null,
    },
  ],
  dispenser: { id: 'user-sato', name: '佐藤 花子', time_label: '09:30' },
  auditor: { id: 'user-yamada', name: '山田 太郎' },
  is_self_audit: false,
  has_narcotic: true,
  visit_time_label: '14:00',
  resolved_inquiry: null,
  team_audit_total: 24,
  stock_check_date_label: '6/9',
};

const COCKPIT = {
  generated_at: '2026-06-11T09:42:00',
  cycle_status_counts: {},
  audit_pending_count: 6,
  narcotic_audit_count: 1,
  audit_queue: [],
  today_visits: [],
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

function fillCount(drugName: string, slot: '1回目' | '2回目', value: number) {
  fireEvent.change(screen.getByLabelText(`${drugName} 計数${slot}`), {
    target: { value: String(value) },
  });
}

describe('AuditWorkbench', () => {
  const mutateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
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

  it('私の監査キュー+二人制バナー+麻薬ダブルカウントを新デザインの文言で描画する', () => {
    render(<AuditWorkbench />);

    // ページヘッダー
    expect(screen.getByRole('heading', { name: '監査' })).toBeTruthy();
    expect(screen.getByText(/止める勇気の画面・合格か差戻しの二択/)).toBeTruthy();

    // 左: 私の監査キュー(6件・期限順 / 麻薬バッジ / 期限 / 集約行)
    expect(screen.getByText('私の監査キュー')).toBeTruthy();
    expect(screen.getByText('6件・期限順')).toBeTruthy();
    expect(screen.getAllByText('麻薬').length).toBeGreaterThan(0);
    expect(screen.getByText('田中 一郎 様')).toBeTruthy();
    expect(screen.getByText('期限12:00')).toBeTruthy();
    expect(screen.getByText('調剤: 佐藤 09:30 完了')).toBeTruthy();
    expect(screen.getByText('伊藤 キヨ 様')).toBeTruthy();
    expect(screen.getByText('山口 清 様(施設GH)')).toBeTruthy();
    const requestLinks = screen.getAllByTestId('audit-work-request-link');
    expect(requestLinks[0].getAttribute('href')).toContain(
      'work_request_type=staff_work_request_audit',
    );
    expect(requestLinks[0].getAttribute('href')).toContain('related_entity_type=dispense_task');
    expect(requestLinks[0].getAttribute('href')).toContain('related_entity_id=task-tanaka');
    expect(screen.getByText('ほか3件')).toBeTruthy();
    expect(screen.getByText('チーム全体では24件 — 詰まり工程')).toBeTruthy();

    // 中央: ヘッダー+二人制バナー
    expect(screen.getByText(/麻薬監査 — 田中 一郎 様 RX-2024-0500/)).toBeTruthy();
    expect(screen.getByText('麻薬: ダブルカウント必須')).toBeTruthy();
    const banner = screen.getByTestId('two-person-banner');
    expect(banner.textContent).toContain('二人制');
    expect(banner.textContent).toContain('調剤: 佐藤(09:30)');
    expect(banner.textContent).toContain('監査: 山田(あなた)');
    expect(banner.textContent).toContain('同一人による監査はシステム上できません');

    // 調剤から監査への引継ぎサマリー
    expect(screen.getByTestId('audit-handoff-summary')).toBeTruthy();
    expect(screen.getByText('調剤から監査への引継ぎ')).toBeTruthy();
    expect(screen.getByText('照会回答の変更点を読み上げ確認')).toBeTruthy();
    expect(screen.getByText('変更薬剤')).toBeTruthy();
    expect(screen.getByText('疑義照会回答由来の変更')).toBeTruthy();
    expect(screen.getByText('処方数量未確定')).toBeTruthy();
    expect(screen.getByText('実数量未入力 0件')).toBeTruthy();

    // 中央薬剤フォーマット: 監査でも調剤と同じ行構造で時点量・特殊管理を確認する
    expect(screen.getByTestId('medication-format-grid')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '監査薬剤フォーマット' })).toBeTruthy();
    expect(screen.getByText('調剤監査 / 4品目')).toBeTruthy();
    expect(screen.getAllByText('頓用').length).toBeGreaterThan(0);
    expect(screen.getAllByText('一包化').length).toBeGreaterThan(0);
    expect(screen.getAllByText('外用・注射・非内服').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('アムロジピン 5mg 朝 1錠').length).toBeGreaterThan(0);
    expect(screen.getAllByText('調剤済').length).toBeGreaterThan(0);

    // 計数テーブル
    expect(screen.getByText('計数(調剤者)')).toBeTruthy();
    expect(screen.getByText('計数 1回目')).toBeTruthy();
    expect(screen.getByText('計数 2回目')).toBeTruthy();
    expect(screen.getAllByText('オキシコドン 5mg').length).toBeGreaterThan(0);
    expect(screen.getAllByText('冷所').length).toBeGreaterThanOrEqual(2);

    // 工程チップ+確定メッセージ
    expect(screen.getByText('セット 15分')).toBeTruthy();
    expect(screen.getByText('14:00 訪問')).toBeTruthy();
    expect(screen.getByText('合格すると午後の予定がすべて確定します')).toBeTruthy();

    // アクション行: 計数未完了のため合格は不可+ガード文言
    const approveButton = screen.getByTestId('audit-approve-button') as HTMLButtonElement;
    expect(approveButton.textContent).toContain('差異ゼロを確認して合格 — セットへ');
    expect(approveButton.disabled).toBe(true);
    expect(screen.getByTestId('audit-reject-button').textContent).toContain('差戻し(理由必須)');
    expect(screen.getByTestId('audit-hold-button').textContent).toContain('保留(理由必須)');
    expect(screen.getByTestId('audit-emergency-button').textContent).toContain(
      '緊急例外承認(管理者)',
    );
    expect(screen.getByText('麻薬は2回目の計数が終わるまで合格できません')).toBeTruthy();

    // 右レール
    expect(screen.getByText('1回目の計数を入力する')).toBeTruthy();
    expect(screen.getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(screen.getByText('調剤記録(佐藤)')).toBeTruthy();
    expect(screen.getByText('麻薬管理簿')).toBeTruthy();
    expect(screen.getByText('残数照合済')).toBeTruthy();
    expect(screen.getByText('棚卸し')).toBeTruthy();
  });

  it('全行の計数が一致(差異ゼロ)すると合格でき、計数値つきで送信する', () => {
    render(<AuditWorkbench />);

    fillCount('オキシコドン 5mg', '1回目', 14);
    fillCount('アムロジピン 5mg', '1回目', 28);
    fillCount('ランソプラゾール 15mg', '1回目', 28);
    fillCount('インスリン グラルギン', '1回目', 1);

    // 1回目のみでは合格不可(2回目が残っている)
    expect((screen.getByTestId('audit-approve-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('2回目の計数を入力する')).toBeTruthy();

    fillCount('オキシコドン 5mg', '2回目', 14);
    fillCount('アムロジピン 5mg', '2回目', 28);
    fillCount('ランソプラゾール 15mg', '2回目', 28);
    fillCount('インスリン グラルギン', '2回目', 1);

    expect(screen.getAllByText('一致')).toHaveLength(4);

    const approveButton = screen.getByTestId('audit-approve-button') as HTMLButtonElement;
    expect(approveButton.disabled).toBe(false);
    fireEvent.click(approveButton);

    expect(mutateMock).toHaveBeenCalledWith({ result: 'approved' });
  });

  it('処方数量未確定があると全行の計数が一致しても監査合格できない', () => {
    const unresolvedWorkbench: DispenseWorkbenchData = {
      ...WORKBENCH,
      count_rows: WORKBENCH.count_rows.map((row) =>
        row.line_id === 'line-oxycodone'
          ? { ...row, prescribed_label: '未確定', prescribed_quantity: null }
          : row,
      ),
    };
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'dispense-workbench') {
        return { data: unresolvedWorkbench, isLoading: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: COCKPIT, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });

    render(<AuditWorkbench />);

    fillCount('オキシコドン 5mg', '1回目', 14);
    fillCount('アムロジピン 5mg', '1回目', 28);
    fillCount('ランソプラゾール 15mg', '1回目', 28);
    fillCount('インスリン グラルギン', '1回目', 1);
    fillCount('オキシコドン 5mg', '2回目', 14);
    fillCount('アムロジピン 5mg', '2回目', 28);
    fillCount('ランソプラゾール 15mg', '2回目', 28);
    fillCount('インスリン グラルギン', '2回目', 1);

    expect(screen.getByText('処方数量未確定を処方取込で確認')).toBeTruthy();
    expect(screen.getByText('処方数量未確定があるため合格できません')).toBeTruthy();

    const approveButton = screen.getByTestId('audit-approve-button') as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);
    fireEvent.click(approveButton);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('計数が調剤実績とズレると「不一致」を表示し合格できない', () => {
    render(<AuditWorkbench />);

    fillCount('オキシコドン 5mg', '1回目', 14);
    fillCount('オキシコドン 5mg', '2回目', 13);

    expect(screen.getByText('不一致')).toBeTruthy();
    expect((screen.getByTestId('audit-approve-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('taskId クエリがある場合はその監査タスクを初期表示する', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('taskId=task-ito'));

    render(<AuditWorkbench />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['dispense-workbench', 'task-ito', 'org_1'],
      }),
    );
  });

  it('保留理由を選ぶと hold と理由を送信する', () => {
    render(<AuditWorkbench />);

    fireEvent.click(screen.getByTestId('audit-hold-button'));
    fireEvent.click(screen.getByRole('button', { name: '処方医確認待ち' }));
    fireEvent.change(screen.getByPlaceholderText('メモ(必要な時だけ)'), {
      target: { value: '  医師へ減量根拠を確認中 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保留する' }));

    expect(mutateMock).toHaveBeenCalledWith({
      result: 'hold',
      reject_reason: '処方医確認待ち',
      reject_reason_code: 'waiting_prescriber',
      reject_detail: '医師へ減量根拠を確認中',
    });
  });

  it('緊急例外承認は管理者限定の理由記録つきで送信する', () => {
    render(<AuditWorkbench />);

    fireEvent.click(screen.getByTestId('audit-emergency-button'));
    expect(
      screen.getByText(
        '管理者のみ実行できます。通常の合格条件を満たせない理由と確認済み事項を残してください。',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '訪問時刻が迫っている' }));
    fireEvent.change(screen.getByPlaceholderText('メモ(必要な時だけ)'), {
      target: { value: '  管理者確認済み。訪問出発時刻まで15分 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '緊急例外承認する' }));

    expect(mutateMock).toHaveBeenCalledWith({
      result: 'emergency_approved',
      reject_reason: '訪問時刻が迫っている',
      reject_reason_code: 'visit_deadline',
      reject_detail: '訪問時刻が迫っている: 管理者確認済み。訪問出発時刻まで15分',
    });
  });
});
