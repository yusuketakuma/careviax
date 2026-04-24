'use client';

import Link from 'next/link';
import {
  ArrowRight,
  FileText,
  MessagesSquare,
  Share2,
  Stethoscope,
  UserRoundCog,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type CollaborationWorkflowFocus =
  | 'conference'
  | 'requests'
  | 'external'
  | 'share'
  | 'master'
  | 'reports';

type CollaborationLane = {
  key: string;
  stage: string;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  icon: LucideIcon;
  focuses: CollaborationWorkflowFocus[];
};

const COLLABORATION_LANES: readonly CollaborationLane[] = [
  {
    key: 'inquiry',
    stage: '処方登録・調剤監査',
    title: '疑義照会と依頼を起点にする',
    description:
      '処方差分、残薬調整、医師確認を依頼・照会として残し、回答後に調剤監査へ戻します。',
    href: '/communications/requests',
    actionLabel: '依頼・照会を開く',
    icon: MessagesSquare,
    focuses: ['requests'],
  },
  {
    key: 'conference',
    stage: 'スケジュール登録・訪問時',
    title: '訪問前後の論点を共有する',
    description:
      'カンファレンス、MCS、申し送りで訪問前の確認点と訪問後の引き継ぎを揃えます。',
    href: '/conferences',
    actionLabel: 'カンファレンスを開く',
    icon: UsersRound,
    focuses: ['conference'],
  },
  {
    key: 'external-share',
    stage: '訪問時・報告書',
    title: '共有範囲と閲覧状況を管理する',
    description:
      '患者単位の外部共有リンク、自己申告、閲覧状況を追い、必要な連絡へ戻します。',
    href: '/external',
    actionLabel: '外部連携を開く',
    icon: Share2,
    focuses: ['external', 'share'],
  },
  {
    key: 'report-delivery',
    stage: '報告書',
    title: '報告書の送付と返信を閉じる',
    description:
      '医師・ケアマネ向け報告書の送達、返信待ち、再送を確認して連携を完了させます。',
    href: '/reports',
    actionLabel: '報告書を開く',
    icon: FileText,
    focuses: ['reports'],
  },
  {
    key: 'master',
    stage: '連携先マスター',
    title: '連携先の連絡先を整える',
    description:
      '医師、看護師、ケアマネの職種・施設・推奨チャネルを保守し、送付先候補の精度を上げます。',
    href: '/admin/external-professionals',
    actionLabel: '他職種マスターを開く',
    icon: UserRoundCog,
    focuses: ['master'],
  },
] as const;

export function CollaborationWorkflowPanel({
  focus,
  title = '他職種連携の接続点',
  description = '他職種連携を主業務フローの横断支援として整理し、処方確認、訪問前後の共有、報告書送付へ戻れるようにしています。',
}: {
  focus?: CollaborationWorkflowFocus;
  title?: string;
  description?: string;
}) {
  return (
    <section
      className="rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:px-5"
      data-testid="collaboration-workflow-panel"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="max-w-4xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">
          <Stethoscope className="size-4" aria-hidden="true" />
          主業務フローの横断支援
        </div>
      </div>

      <ol className="mt-4 grid gap-3 lg:grid-cols-5">
        {COLLABORATION_LANES.map((lane) => {
          const Icon = lane.icon;
          const active = focus ? lane.focuses.includes(focus) : false;

          return (
            <li key={lane.key}>
              <div
                className={cn(
                  'flex h-full flex-col rounded-xl border px-3 py-3',
                  active ? 'border-primary/40 bg-primary/[0.08]' : 'border-border/70 bg-background',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {lane.stage}
                    </p>
                    <p className={cn('text-sm font-semibold', active ? 'text-primary' : 'text-foreground')}>
                      {lane.title}
                    </p>
                  </div>
                  <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/20">
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{lane.description}</p>
                <Link
                  href={lane.href}
                  className="mt-auto inline-flex min-h-11 items-center gap-2 rounded-lg pt-3 text-sm font-medium text-primary hover:underline"
                >
                  {lane.actionLabel}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
