'use client';

import { CalendarDays, FolderKanban, ListChecks, Receipt, Settings2, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { HelpPopover } from '@/components/ui/help-popover';
import { Separator } from '@/components/ui/separator';
import { AdminNavigation } from './admin-navigation';
import { BillingKpiSection } from './billing-kpi-section';
import { DashboardSectionGroup } from './dashboard-section-group';
import { PatientGridSection } from './patient-grid-section';
import { CoordinationNavigation } from './coordination-navigation';
import { DashboardRoleGuide } from './dashboard-role-guide';
import { type DashboardFocusRole } from './dashboard-role-focus';
import { ScheduleSection } from './schedule-section';
import { TodayTasksSection } from './today-tasks-section';
import { WorkbenchNavigation } from './workbench-navigation';
import { WorkflowNavigation } from './workflow-navigation';

export {
  DashboardOverview,
  type DashboardToday,
  type WorkflowDashboard,
} from './dashboard-content-legacy';

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof CalendarDays;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/15">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <HelpPopover title={title} description={description} />
        </div>
      </div>
    </div>
  );
}

function NavigationCluster({
  title,
  description,
  children,
  tone = 'default',
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  tone?: 'default' | 'cool' | 'warm' | 'neutral';
}) {
  const toneClasses = {
    default: 'border-border/70 bg-muted/15',
    cool: 'border-primary/15 bg-primary/[0.05]',
    warm: 'border-amber-200/80 bg-amber-500/[0.06]',
    neutral: 'border-slate-200/80 bg-slate-500/[0.05]',
  } as const;

  return (
    <Card className={toneClasses[tone]}>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <HelpPopover title={title} description={description} />
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function DashboardContent({ focusRole = 'common' }: { focusRole?: DashboardFocusRole }) {
  return (
    <div className="space-y-8">
      <DashboardSectionGroup
        id="dashboard-daily-operations"
        eyebrow="Daily Operations"
        title="今日の運用"
        description="緊急度、今日の予定、優先作業をひとまとまりにし、出勤直後にその日の動きを決めやすい配置へ整理しています。"
        tone="daily"
      >
        <div
          className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.95fr)]"
          data-testid="dashboard-priority-actions"
        >
          <section className="space-y-4" aria-labelledby="dashboard-tasks-section">
            <SectionHeader
              icon={ListChecks}
              title="今日のタスク"
              description="緊急度、担当の起点、工程別の滞留を見ながら、上から順にそのまま処理画面へ進みます。"
            />
            <div id="dashboard-tasks-section">
              <TodayTasksSection focusRole={focusRole} />
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="dashboard-schedule-section">
            <SectionHeader
              icon={CalendarDays}
              title="スケジュール"
              description="今日の訪問実行と日程調整を見分けやすくするため、日次リストと全体カレンダーを同じ場所にまとめています。"
            />
            <div id="dashboard-schedule-section">
              <ScheduleSection focusRole={focusRole} />
            </div>
          </section>
        </div>
      </DashboardSectionGroup>

      <DashboardSectionGroup
        id="dashboard-navigation-group"
        eyebrow="Workflow Navigation"
        title="業務導線"
        description="日次の優先判断を終えたあとに、職種ごとの初動と主業務フローを別グループで追えるようにし、次に開く画面を迷わない構成にしています。"
        tone="workflow"
        contentClassName="space-y-6"
      >
        <div className="space-y-6">
          <section className="space-y-4" aria-labelledby="dashboard-role-guide-section">
            <SectionHeader
              icon={Users}
              title="職種ごとの初動"
              description="薬剤師、事務スタッフ、全員共通の入口を分け、誰が最初に何を確認するかを揃えて判断できるようにしています。"
            />
            <div id="dashboard-role-guide-section">
              <DashboardRoleGuide focusRole={focusRole} />
            </div>
          </section>

          <Separator />

          <section className="space-y-4" aria-labelledby="dashboard-workflows-section">
            <SectionHeader
              icon={FolderKanban}
              title="主業務フロー"
              description="処方登録から報告書までを固定順で見せ、画面の並びそのものを業務手順として読めるようにしています。"
            />
            <div id="dashboard-workflows-section">
              <WorkflowNavigation />
            </div>
          </section>

          <Separator />

          <section className="space-y-4" aria-labelledby="dashboard-secondary-navigation-section">
            <SectionHeader
              icon={Settings2}
              title="補助導線"
              description="個人ワークベンチ、連携系、運営系の支援画面を意味ごとに束ねています。"
            />
            <div id="dashboard-secondary-navigation-section" className="grid gap-4 xl:grid-cols-3">
              <NavigationCluster
                title="共通ワークベンチ"
                description="個人タスク、請求、提案確認などの横断作業。"
                tone="cool"
              >
                <WorkbenchNavigation focusRole={focusRole} />
              </NavigationCluster>
              <NavigationCluster
                title="連携・モニタ"
                description="通知、外部連携、依頼・照会、申し送り。"
                tone="warm"
              >
                <CoordinationNavigation focusRole={focusRole} />
              </NavigationCluster>
              <NavigationCluster
                title="運営・管理"
                description="管理ダッシュボード、監視、分析、探索。"
                tone="neutral"
              >
                <AdminNavigation />
              </NavigationCluster>
            </div>
          </section>
        </div>
      </DashboardSectionGroup>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
        <DashboardSectionGroup
          id="dashboard-patients-group"
          eyebrow="Patient Monitoring"
          title="患者確認"
          description="患者検索とリスク確認を横断監視として独立させ、日次業務を回し始めた後に見直しやすくしています。"
          tone="monitoring"
        >
          <section className="space-y-4" aria-labelledby="dashboard-patients-section">
            <SectionHeader
              icon={Users}
              title="患者カード"
              description="リスク順に患者を並べ、検索しながら処方受付や個別確認へそのまま遷移します。"
            />
            <div id="dashboard-patients-section">
              <PatientGridSection />
            </div>
          </section>
        </DashboardSectionGroup>

        <DashboardSectionGroup
          id="dashboard-billing-kpi"
          eyebrow="Billing KPI"
          title="請求状況"
          description="当月の請求候補、未確定、締めブロッカーを補助監視として分離し、月次締め前の確認を独立して行えるようにしています。"
          tone="reference"
          className="self-start"
        >
          <section className="space-y-4" aria-labelledby="dashboard-billing-kpi-section">
            <SectionHeader
              icon={Receipt}
              title="当月請求 KPI"
              description="候補数、未確定、ブロッカーを見て、月次締め前に対処が必要な項目を把握します。"
            />
            <div id="dashboard-billing-kpi-section">
              <BillingKpiSection />
            </div>
          </section>
        </DashboardSectionGroup>
      </div>
    </div>
  );
}
