'use client';

import { CalendarDays, FolderKanban, ListChecks, Settings2, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { AdminNavigation } from './admin-navigation';
import { PatientGridSection } from './patient-grid-section';
import { CoordinationNavigation } from './coordination-navigation';
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
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function NavigationCluster({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/70 bg-muted/15">
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function DashboardContent() {
  return (
    <div className="space-y-8">
      <div
        className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
        data-testid="dashboard-priority-actions"
      >
        <section className="space-y-4" aria-labelledby="dashboard-tasks-section">
          <SectionHeader
            icon={ListChecks}
            title="今日のタスク"
            description="優先度の高い対応を最初に処理できるよう、当日タスクを先頭に固定しています。"
          />
          <div id="dashboard-tasks-section">
            <TodayTasksSection />
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="dashboard-workflows-section">
          <SectionHeader
            icon={FolderKanban}
            title="主要フロー入口"
            description="最初に始める入口を3つに絞って上段へ置き、その後の処理フローは一段下で続けてたどれるようにしています。"
          />
          <div id="dashboard-workflows-section">
            <WorkflowNavigation />
          </div>
        </section>
      </div>

      <section className="space-y-4" aria-labelledby="dashboard-secondary-navigation-section">
        <SectionHeader
          icon={Settings2}
          title="補助導線"
          description="二次タスクと支援機能は意味ごとに束ね、画面密度を保ったまま探しやすくしています。"
        />
        <div id="dashboard-secondary-navigation-section" className="grid gap-4 xl:grid-cols-3">
          <NavigationCluster
            title="共通ワークベンチ"
            description="個人タスク、請求、提案確認などの横断作業。"
          >
            <WorkbenchNavigation />
          </NavigationCluster>
          <NavigationCluster
            title="連携・モニタ"
            description="通知、外部連携、依頼・照会、申し送り。"
          >
            <CoordinationNavigation />
          </NavigationCluster>
          <NavigationCluster
            title="運営・管理"
            description="管理ダッシュボード、監視、分析、探索。"
          >
            <AdminNavigation />
          </NavigationCluster>
        </div>
      </section>

      <div className="grid gap-8 xl:grid-cols-2">
        <section className="space-y-4" aria-labelledby="dashboard-schedule-section">
          <SectionHeader
            icon={CalendarDays}
            title="スケジュール"
            description="日次リストと月間カレンダーを切り替えながら、訪問予定と処方未着をまとめて確認します。"
          />
          <div id="dashboard-schedule-section">
            <ScheduleSection />
          </div>
        </section>

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
      </div>
    </div>
  );
}
