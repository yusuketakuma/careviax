'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, FolderKanban, Receipt, Settings2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { HelpPopover } from '@/components/ui/help-popover';
import { Separator } from '@/components/ui/separator';
import { AdminNavigation } from './admin-navigation';
import { BillingKpiSection } from './billing-kpi-section';
import { DashboardCockpit } from './dashboard-cockpit';
import { DashboardSectionGroup } from './dashboard-section-group';
import { CoordinationNavigation } from './coordination-navigation';
import { DashboardRoleGuide } from './dashboard-role-guide';
import { type DashboardFocusRole } from './dashboard-role-focus';
import { ScheduleSection } from './schedule-section';
import { WorkbenchNavigation } from './workbench-navigation';
import { WorkflowNavigation } from './workflow-navigation';

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

function DeferredDashboardMount({
  anchorId,
  label,
  actionLabel,
  children,
}: {
  anchorId: string;
  label: string;
  actionLabel: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mounted) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    if (window.location.hash === `#${anchorId}`) {
      const timeout = window.setTimeout(() => setMounted(true), 0);
      return () => window.clearTimeout(timeout);
    }

    const onHashChange = () => {
      if (window.location.hash === `#${anchorId}`) {
        setMounted(true);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [anchorId, mounted]);

  return (
    <div ref={sentinelRef} aria-busy={!mounted} aria-label={mounted ? undefined : label}>
      {mounted ? (
        children
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border/80 bg-muted/10 px-4 py-3">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Button type="button" variant="outline" onClick={() => setMounted(true)}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * /dashboard 本文。最上部は new_01_dashboard の運用コックピット
 * (2 カラム: 条件バナー/今すぐ対応/今日の流れ/工程の今 + 右レール)。
 */
export function DashboardContent({ focusRole = 'common' }: { focusRole?: DashboardFocusRole }) {
  return (
    <div className="space-y-8">
      <DashboardCockpit />

      <DashboardSectionGroup
        id="dashboard-schedule-group"
        eyebrow="Schedule"
        title="スケジュール"
        description="今日の訪問実行と日程調整を見分けやすくするため、日次リストと全体カレンダーをまとめています。"
        tone="daily"
      >
        <section className="space-y-4" aria-labelledby="dashboard-schedule-section">
          <SectionHeader
            icon={CalendarDays}
            title="スケジュール"
            description="訪問実行と日程調整を見分けやすくするため、日次リストと全体カレンダーを同じ場所にまとめています。"
          />
          <div id="dashboard-schedule-section">
            <DeferredDashboardMount
              anchorId="dashboard-schedule-section"
              label="スケジュールを読み込み中"
              actionLabel="スケジュールを開く"
            >
              <ScheduleSection focusRole={focusRole} />
            </DeferredDashboardMount>
          </div>
        </section>
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
                description="マスター、監視、分析、探索。"
                tone="neutral"
              >
                <AdminNavigation />
              </NavigationCluster>
            </div>
          </section>
        </div>
      </DashboardSectionGroup>

      <DashboardSectionGroup
        id="dashboard-billing-kpi"
        eyebrow="Billing KPI"
        title="請求状況"
        description="当月の請求候補、未確定、締めを止めている理由を補助監視として分離し、月次締め前の確認を独立して行えるようにしています。"
        tone="reference"
      >
        <section className="space-y-4" aria-labelledby="dashboard-billing-kpi-section">
          <SectionHeader
            icon={Receipt}
            title="当月請求 KPI"
            description="候補数、未確定、止まっている理由を見て、月次締め前に対処が必要な項目を把握します。"
          />
          <div id="dashboard-billing-kpi-section">
            <DeferredDashboardMount
              anchorId="dashboard-billing-kpi-section"
              label="請求KPIを読み込み中"
              actionLabel="請求KPIを開く"
            >
              <BillingKpiSection />
            </DeferredDashboardMount>
          </div>
        </section>
      </DashboardSectionGroup>
    </div>
  );
}
