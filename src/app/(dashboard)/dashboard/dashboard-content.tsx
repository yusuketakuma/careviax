'use client';

import { CalendarDays, ListChecks, Users } from 'lucide-react';
import { PatientGridSection } from './patient-grid-section';
import { ScheduleSection } from './schedule-section';
import { TodayTasksSection } from './today-tasks-section';
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

export function DashboardContent() {
  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="dashboard-tasks-section">
        <SectionHeader
          icon={ListChecks}
          title="今日のタスク"
          description="カテゴリ別にタスクを確認し、優先度の高いものから対応できます。"
        />
        <div id="dashboard-tasks-section">
          <TodayTasksSection />
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="dashboard-workflows-section">
        <SectionHeader
          icon={ListChecks}
          title="業務フロー入口"
          description="処方登録から他職種連携まで、主要フローへ直接移動できます。"
        />
        <div id="dashboard-workflows-section">
          <WorkflowNavigation />
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
