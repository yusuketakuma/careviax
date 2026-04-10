'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Clock3,
  FilePlus,
  FileText,
  MessagesSquare,
  Package,
  Pill,
  QrCode,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DASHBOARD_COORDINATION_LINKS,
  DASHBOARD_WORKBENCH_LINKS,
  DASHBOARD_WORKFLOW_LINKS,
} from '@/lib/dashboard/home-config';
import { cn } from '@/lib/utils';
import { type DashboardFocusRole } from './dashboard-role-focus';

type RoleGuide = {
  key: DashboardFocusRole;
  title: string;
  label: string;
  description: string;
  icon: typeof Stethoscope;
  accentClassName: string;
  points: string[];
  quickLinkKeys: string[];
};

const QUICK_LINK_ICON_MAP = {
  my_day: Clock3,
  tasks: CheckSquare,
  notifications: Bell,
  handoff: ClipboardList,
  referrals: Users,
  prescriptions: FilePlus,
  qr_drafts: QrCode,
  schedules: CalendarDays,
  communications: MessagesSquare,
  dispensing: Pill,
  auditing: ShieldCheck,
  medication_sets: Package,
  visits: Stethoscope,
  reports: FileText,
  schedule_proposals: CalendarClock,
} as const;

const DASHBOARD_ROLE_GUIDES: readonly RoleGuide[] = [
  {
    key: 'pharmacist',
    title: '薬剤師',
    label: 'Clinical Flow',
    description:
      '優先アクション、訪問準備、調剤から報告書までを上から順に追って、現場判断を止めないための導線です。',
    icon: Stethoscope,
    accentClassName: 'border-sky-200 bg-sky-50/60',
    points: [
      '緊急アクションと本日の訪問予定を最初に確認する',
      '調剤、監査、セット、訪問記録を優先度順で処理する',
      '報告書と申し送りを最後に残さず完了させる',
    ],
    quickLinkKeys: ['my_day', 'dispensing', 'auditing', 'medication_sets', 'visits', 'reports'],
  },
  {
    key: 'clerk',
    title: '事務スタッフ',
    label: 'Front Desk Flow',
    description:
      '受付起点の作業をまとめ、紹介、処方登録、QR処理、日程調整、照会対応までを迷わず辿れるようにしています。',
    icon: UserCog,
    accentClassName: 'border-amber-200 bg-amber-50/70',
    points: [
      '紹介受付と新規処方を先に確定し、未着や不足を止める',
      'QR 下書きやスキャン結果を確認し、受付入力へ引き継ぐ',
      'スケジュール調整、依頼・照会、申し送りを日中の窓口として回す',
    ],
    quickLinkKeys: [
      'referrals',
      'prescriptions',
      'qr_drafts',
      'schedules',
      'communications',
      'schedule_proposals',
    ],
  },
  {
    key: 'common',
    title: '全員共通',
    label: 'Shared Queue',
    description:
      '個人タスク、通知、申し送りの確認を共通入口として切り出し、誰が何を引き取るかを揃えて判断できるようにしています。',
    icon: ClipboardList,
    accentClassName: 'border-emerald-200 bg-emerald-50/60',
    points: [
      '自分の担当は My Day とタスク一覧で最初に確認する',
      '未読通知と申し送りを開き、引き継ぎ漏れを防ぐ',
      '迷ったらタスク一覧で再割当や棚卸しを行う',
    ],
    quickLinkKeys: ['my_day', 'tasks', 'notifications', 'handoff'],
  },
] as const;

const QUICK_LINKS = [
  ...DASHBOARD_WORKFLOW_LINKS,
  ...DASHBOARD_WORKBENCH_LINKS,
  ...DASHBOARD_COORDINATION_LINKS,
];

const QUICK_LINK_LOOKUP = new Map(QUICK_LINKS.map((link) => [link.key, link]));

function QuickLink({
  linkKey,
  accentClassName,
}: {
  linkKey: string;
  accentClassName: string;
}) {
  const link = QUICK_LINK_LOOKUP.get(linkKey);
  if (!link) return null;

  const Icon = QUICK_LINK_ICON_MAP[linkKey as keyof typeof QUICK_LINK_ICON_MAP];

  return (
    <Link
      href={link.href}
      className={cn(
        'inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background',
        accentClassName,
      )}
    >
      {Icon ? <Icon className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
      <span>{link.title}</span>
      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function RoleGuideCard({
  guide,
  isActive,
}: {
  guide: RoleGuide;
  isActive: boolean;
}) {
  const Icon = guide.icon;

  return (
    <Card
      className={cn(
        'border-border/70 shadow-none transition-shadow',
        guide.accentClassName,
        isActive ? 'ring-2 ring-primary/30 shadow-sm' : null,
      )}
      data-testid={isActive ? `dashboard-role-guide-active-${guide.key}` : undefined}
    >
      <CardContent className="space-y-4 p-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {guide.label}
            </p>
            {isActive ? <Badge className="bg-primary text-primary-foreground">現在の担当</Badge> : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex size-9 items-center justify-center rounded-full border border-background/80 bg-background/90">
              <Icon className="size-4 text-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold text-foreground">{guide.title}</h3>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{guide.description}</p>
        </div>

        <div className="rounded-xl border border-border/70 bg-background/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            最初に確認すること
          </p>
          <ol className="mt-3 space-y-2">
            {guide.points.map((point, index) => (
              <li key={point} className="flex gap-3 text-sm text-foreground">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/40 text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <span className="leading-6">{point}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            すぐ開く画面
          </p>
          <div className="flex flex-wrap gap-2">
            {guide.quickLinkKeys.map((linkKey) => (
              <QuickLink
                key={`${guide.key}-${linkKey}`}
                linkKey={linkKey}
                accentClassName={guide.accentClassName}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardRoleGuide({
  focusRole = 'common',
}: {
  focusRole?: DashboardFocusRole;
}) {
  const orderedGuides = [
    ...DASHBOARD_ROLE_GUIDES.filter((guide) => guide.key === focusRole),
    ...DASHBOARD_ROLE_GUIDES.filter((guide) => guide.key !== focusRole),
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-3" data-testid="dashboard-role-guide">
      {orderedGuides.map((guide) => (
        <RoleGuideCard key={guide.key} guide={guide} isActive={guide.key === focusRole} />
      ))}
    </div>
  );
}
