'use client';

import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FilePlus,
  FileText,
  Package,
  Pill,
  ShieldCheck,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { HelpPopover } from '@/components/ui/help-popover';

export type MainWorkflowStepKey =
  | 'prescriptions'
  | 'dispensing'
  | 'auditing'
  | 'medication_sets'
  | 'set_audit'
  | 'schedules'
  | 'visits'
  | 'reports';

export type MainWorkflowStep = {
  key: MainWorkflowStepKey;
  step: string;
  title: string;
  description: string;
  href: string;
  surfaceLabel: string;
  icon: LucideIcon;
};

export const MAIN_WORKFLOW_STEPS: readonly MainWorkflowStep[] = [
  {
    key: 'prescriptions',
    step: '01',
    title: '処方登録',
    description: '受付済み処方を登録し、以降の工程へ渡す起点をここで揃えます。',
    href: '/prescriptions',
    surfaceLabel: '処方受付',
    icon: FilePlus,
  },
  {
    key: 'dispensing',
    step: '02',
    title: '調剤',
    description: '調剤待ちキューから優先案件を処理し、実施結果を固めます。',
    href: '/dispensing',
    surfaceLabel: '調剤キュー',
    icon: Pill,
  },
  {
    key: 'auditing',
    step: '03',
    title: '調剤監査',
    description: '調剤結果を監査し、差戻しや確認漏れをここで止めます。',
    href: '/auditing',
    surfaceLabel: '調剤監査',
    icon: ShieldCheck,
  },
  {
    key: 'medication_sets',
    step: '04',
    title: 'セット',
    description: '持参計画とセット内容を作り、訪問前の準備へ進めます。',
    href: '/medication-sets',
    surfaceLabel: 'セット管理',
    icon: Package,
  },
  {
    key: 'set_audit',
    step: '05',
    title: 'セット監査',
    description: 'セット結果の承認・差戻しを確認し、持参内容を確定します。',
    href: '/medication-sets',
    surfaceLabel: 'セット監査',
    icon: ClipboardCheck,
  },
  {
    key: 'schedules',
    step: '06',
    title: 'スケジュール登録',
    description: '訪問予定を登録し、日次運用へ乗る順番まで整えます。',
    href: '/schedules',
    surfaceLabel: '訪問スケジュール',
    icon: CalendarDays,
  },
  {
    key: 'visits',
    step: '07',
    title: '訪問時',
    description: '現場で必要な記録、持参情報、要点確認をまとめて開きます。',
    href: '/visits',
    surfaceLabel: '訪問記録',
    icon: Stethoscope,
  },
  {
    key: 'reports',
    step: '08',
    title: '報告書',
    description: '訪問後の報告作成と送達確認を最後の工程として閉じます。',
    href: '/reports',
    surfaceLabel: '報告書一覧',
    icon: FileText,
  },
] as const;

type MainWorkflowRouteProps = {
  eyebrow?: string;
  summary?: string;
  detail?: string;
  footer?: string;
  dataTestId?: string;
};

function MainWorkflowCard({
  step,
  index,
}: {
  step: MainWorkflowStep;
  index: number;
}) {
  const Icon = step.icon;

  return (
    <li className="h-full">
      <Card className="h-full border-border/70 bg-background/80 shadow-none transition-colors hover:border-primary/40 hover:bg-primary/[0.04]">
        <CardContent className="flex h-full flex-col gap-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Step {step.step}
              </p>
              <p className="text-sm text-muted-foreground">{index + 1}/8 工程</p>
            </div>
            <div className="inline-flex size-10 items-center justify-center rounded-xl border border-border/70 bg-muted/25 text-foreground">
              <Icon className="size-[1.125rem]" aria-hidden="true" />
            </div>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-base font-semibold text-foreground">{step.title}</p>
              <p className="text-xs font-medium text-muted-foreground">{step.surfaceLabel}</p>
            </div>
            <HelpPopover title={step.title} description={step.description} />
          </div>

          <div className="mt-auto border-t border-border/70 pt-3">
            <Link
              href={step.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.06]"
            >
              {step.title}を開く
              <ArrowRight
                className="size-4 text-primary transition-transform"
                aria-hidden="true"
              />
            </Link>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

export function MainWorkflowRoute({
  eyebrow = '固定順のメイン導線',
  summary = '処方登録から報告書まで、主業務フローを固定の 8 ステップで並べています。',
  detail = '紹介受付、QR、照会や連携系は前後工程の支援として別グループに分離し、この本流では「次に進む工程」だけを追えるようにしています。',
  footer = '本流の前段支援は「職種ごとの初動」、通知や申し送りは「補助導線」から開く前提に整理しています。',
  dataTestId = 'main-workflow-route',
}: MainWorkflowRouteProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-muted/[0.08] p-4 sm:p-5">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
          <p className="text-sm font-medium text-foreground">{summary}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>

      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid={dataTestId}>
        {MAIN_WORKFLOW_STEPS.map((step, index) => (
          <MainWorkflowCard key={step.step} step={step} index={index} />
        ))}
      </ol>

      <div className="rounded-xl border border-dashed border-border/70 bg-background/70 px-4 py-3">
        <p className="text-sm text-muted-foreground">{footer}</p>
      </div>
    </div>
  );
}

type MainWorkflowCompactNavProps = {
  currentSteps: MainWorkflowStepKey[];
  title?: string;
  description?: string;
  dataTestId?: string;
};

export function MainWorkflowCompactNav({
  currentSteps,
  title = '主業務フロー上の現在地',
  description = 'この画面が 8 工程のどこにあるかを固定順で示し、前後工程へ迷わず移れるようにしています。',
  dataTestId = 'main-workflow-compact-nav',
}: MainWorkflowCompactNavProps) {
  const activeSteps = new Set(currentSteps);

  return (
    <section
      className="rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:px-5"
      data-testid={dataTestId}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <ol className="mt-4 grid gap-2 md:grid-cols-4 xl:grid-cols-8">
        {MAIN_WORKFLOW_STEPS.map((step) => {
          const isActive = activeSteps.has(step.key);
          return (
            <li key={`compact-${step.key}`}>
              <div
                className={cn(
                  'rounded-xl border px-3 py-3 transition-colors',
                  isActive
                    ? 'border-primary/40 bg-primary/[0.08] shadow-sm'
                    : 'border-border/70 bg-background',
                )}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {step.step}
                    </span>
                    <span
                      className={cn(
                        'text-[11px] font-medium',
                        isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {isActive ? '現在地' : '工程'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={step.href}
                      className={cn(
                        'min-h-11 rounded-lg py-2 pr-2 text-sm font-semibold transition-colors hover:text-primary',
                        isActive ? 'text-primary' : 'text-foreground',
                      )}
                    >
                      {step.title}
                    </Link>
                    <HelpPopover title={step.title} description={step.description} />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
