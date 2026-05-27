import Link from 'next/link';
import { CalendarRange, Eye, FilePlus, Route } from 'lucide-react';
import {
  DashboardOverview,
  type DashboardToday,
  type WorkflowDashboard,
} from '@/app/(dashboard)/dashboard/dashboard-content';

const mockToday: DashboardToday = {
  visits: {
    total: 12,
    completed: 5,
    pending: 4,
    in_preparation: 3,
    ready: 4,
    cancelled: 0,
  },
  today_visits: [
    {
      id: 'visit_1',
      patient_name: '佐藤 花子',
      address: '東京都千代田区丸の内 1-1-1',
      scheduled_time: '2026-03-29T09:30:00.000Z',
      status: 'in_preparation',
      route_order: 1,
      confirmed: true,
      preparation_ready: false,
      carry_items_status: '確認待ち',
    },
    {
      id: 'visit_2',
      patient_name: '鈴木 一郎',
      address: '東京都中央区銀座 2-3-4',
      scheduled_time: '2026-03-29T11:00:00.000Z',
      status: 'ready',
      route_order: 2,
      confirmed: true,
      preparation_ready: true,
      carry_items_status: '積込済み',
    },
    {
      id: 'visit_3',
      patient_name: '田中 美智子',
      address: '東京都港区芝 3-4-5',
      scheduled_time: '2026-03-29T14:30:00.000Z',
      status: 'planned',
      route_order: 4,
      confirmed: false,
      preparation_ready: false,
      carry_items_status: null,
    },
  ],
  medication_deadlines: [
    {
      id: 'deadline_1',
      patient_name: '小林 みどり',
      due_at: '2026-03-31T00:00:00.000Z',
      days_left: 2,
      source_type: 'refill',
      split_dispense_total: null,
      split_dispense_current: null,
    },
    {
      id: 'deadline_2',
      patient_name: '中村 正',
      due_at: '2026-04-01T00:00:00.000Z',
      days_left: 3,
      source_type: 'split',
      split_dispense_total: 3,
      split_dispense_current: 2,
    },
  ],
};

const mockWorkflow: WorkflowDashboard = {
  phase_access: {
    proposals: {
      preview_items: [
        {
          id: 'proposal_1',
          patient_name: '田中 美智子',
          href: '/schedules/proposals?focus=proposal_1',
          label: '架電待ちを開く',
          sublabel: '患者連絡待ち / 本日午後候補',
        },
      ],
      label: '訪問候補',
      href: '/schedules/proposals',
      pending_count: 3,
      summary: '架電待ち 2 / 承認待ち 1',
      tone: 'warning',
      next_action: {
        href: '/schedules/proposals?focus=proposal_1',
        label: '架電待ちを開く',
      },
    },
    prescriptions: {
      preview_items: [
        {
          id: 'intake_1',
          patient_name: '小林 みどり',
          href: '/prescriptions/new?patient_id=pt_1',
          label: '処方受付を開く',
          sublabel: '継続調剤 / 期限 2 日前',
        },
      ],
      label: '処方受付',
      href: '/prescriptions/new',
      pending_count: 4,
      summary: '未接続 2 / 継続調剤 2',
      tone: 'danger',
      next_action: {
        href: '/prescriptions/new?patient_id=pt_1',
        label: '継続調剤から起票',
      },
    },
    dispensing: {
      preview_items: [
        {
          id: 'dispense_1',
          patient_name: '鈴木 一郎',
          href: '/dispensing/task_1',
          label: '次の調剤を開く',
          sublabel: '朝分セットまで準備済み',
        },
      ],
      label: '調剤',
      href: '/dispensing',
      pending_count: 5,
      summary: '鈴木 一郎 を準備',
      tone: 'warning',
      next_action: {
        href: '/dispensing/task_1',
        label: '次の調剤を開く',
      },
    },
    auditing: {
      preview_items: [
        {
          id: 'audit_1',
          patient_name: '高橋 玲子',
          href: '/auditing/task_2',
          label: '次の鑑査を開く',
          sublabel: '一包化 / 変更後初回',
        },
      ],
      label: '鑑査',
      href: '/auditing',
      pending_count: 2,
      summary: '高橋 玲子 を鑑査',
      tone: 'warning',
      next_action: {
        href: '/auditing/task_2',
        label: '次の鑑査を開く',
      },
    },
    medication_sets: {
      preview_items: [
        {
          id: 'set_1',
          patient_name: '佐藤 花子',
          href: '/medication-sets/audit/plan_1',
          label: 'セット鑑査を開く',
          sublabel: '朝昼夕 7 日分',
        },
      ],
      label: 'セット管理',
      href: '/medication-sets',
      pending_count: 3,
      summary: '佐藤 花子 のセット確認',
      tone: 'warning',
      next_action: {
        href: '/medication-sets/audit/plan_1',
        label: 'セット鑑査を開く',
      },
    },
    visits: {
      preview_items: [
        {
          id: 'visit_1',
          patient_name: '佐藤 花子',
          href: '/visits/visit_1/record',
          label: '訪問記録を開く',
          sublabel: '10:30 出発予定 / 持参物確認待ち',
        },
      ],
      label: '訪問',
      href: '/visits',
      pending_count: 4,
      summary: '佐藤 花子 / in_progress',
      tone: 'danger',
      next_action: {
        href: '/visits/visit_1/record',
        label: '訪問記録を開く',
      },
    },
    reports: {
      preview_items: [
        {
          id: 'report_1',
          patient_name: '中村 正',
          href: '/reports/report_1',
          label: '送達課題を開く',
          sublabel: '報告送達 / FAX 再送待ち',
        },
      ],
      label: '報告',
      href: '/reports',
      pending_count: 3,
      summary: '報告待ち 2 / 送達対応 1',
      tone: 'danger',
      next_action: {
        href: '/reports/report_1',
        label: '送達課題を開く',
      },
    },
  },
  cycle_status_counts: {
    intake_received: 4,
    dispensing_preparing: 5,
    audit_pending: 2,
    visit_scheduled: 4,
    visit_completed: 5,
    reported: 2,
  },
  operations_queue: {
    intake_linkages: 2,
    callback_followups: 3,
    self_reports_triage: 1,
    preparation_pending: 3,
  },
  route_control: {
    pending_override_requests: 1,
    emergency_impact_items: 2,
    locked_schedules: 4,
  },
  unified_workbench: [
    {
      id: 'work_1',
      queue_label: '再架電',
      title: '田中 美智子の訪問候補を確定',
      summary: '午前候補が不在。午後帯へ再調整して患者連絡が必要です。',
      priority: 'high',
      due_at: '2026-03-29T02:00:00.000Z',
      action_href: '/schedules/proposals?focus=proposal_1',
      action_label: '候補を確認',
      patient_name: '田中 美智子',
      badges: ['患者連絡', '当日対応'],
    },
    {
      id: 'work_2',
      queue_label: '処方受付',
      title: '小林 みどりの継続調剤起票',
      summary: '期限 2 日前。処方原本の到着前でも継続調剤の導線を開始します。',
      priority: 'urgent',
      due_at: '2026-03-29T01:00:00.000Z',
      action_href: '/prescriptions/new?patient_id=pt_1',
      action_label: '受付開始',
      patient_name: '小林 みどり',
      badges: ['期限接近'],
    },
  ],
  patient_risk_queue: {
    high_risk_count: 2,
    items: [
      {
        patient_id: 'patient_1',
        patient_name: '佐藤 花子',
        score: 87,
        level: 'high',
        reasons: ['報告滞留', '訪問同意未確認', '自己申告未処理'],
        unresolved_self_reports: 2,
        open_issues: 1,
        disrupted_visits_30d: 1,
        pending_reports: 1,
        open_tasks: 3,
        missing_visit_consent: true,
        missing_management_plan: false,
      },
      {
        patient_id: 'patient_2',
        patient_name: '中村 正',
        score: 72,
        level: 'watch',
        reasons: ['送達再送待ち', '次回調剤接近'],
        unresolved_self_reports: 0,
        open_issues: 1,
        disrupted_visits_30d: 0,
        pending_reports: 1,
        open_tasks: 2,
        missing_visit_consent: false,
        missing_management_plan: true,
      },
    ],
  },
  intake_linkage: [
    {
      id: 'intake_link_1',
      patient_name: '小林 みどり',
      reason: '処方受付後、訪問候補へ未接続です。',
      due_at: '2026-03-29T04:00:00.000Z',
      action_href: '/prescriptions/new?patient_id=pt_1',
      action_label: '処方受付を開く',
      category: '要連結',
    },
  ],
  refill_upcoming: [
    {
      id: 'refill_1',
      cycle_id: 'cycle_1',
      case_id: 'case_1',
      upcoming_kind: 'refill',
      remaining_count: 1,
      split_dispense_total: null,
      split_dispense_current: null,
      next_dispense_date: '2026-03-31T00:00:00.000Z',
      cycle: {
        patient_id: 'patient_1',
        case_: {
          patient: {
            name: '佐藤 花子',
          },
        },
      },
    },
  ],
};

export default function DashboardPreviewPage() {
  const todayLabel = new Intl.DateTimeFormat('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date('2026-03-29T09:00:00+09:00'));

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <Eye className="size-3.5" aria-hidden="true" />
              Preview
            </div>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <CalendarRange className="size-3.5" aria-hidden="true" />
              {todayLabel}
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
              PH-OS ダッシュボード
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              mock データでログイン後ダッシュボードを preview しています。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/workflow"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
            >
              <Route className="size-4" aria-hidden="true" />
              ワークフロー
            </Link>
            <Link
              href="/prescriptions/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <FilePlus className="size-4" aria-hidden="true" />
              処方受付
            </Link>
          </div>
        </div>
      </div>

      <div className="p-6">
        <DashboardOverview today={mockToday} workflow={mockWorkflow} />
      </div>
    </div>
  );
}
