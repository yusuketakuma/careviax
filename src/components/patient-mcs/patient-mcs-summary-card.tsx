'use client';

import { AlertTriangle, CheckCircle2, ClipboardList, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PatientMcsViewSummary } from '@/lib/patient-mcs/dto';

function formatDateTime(value: string | null) {
  if (!value) return '未記録';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function describeFallbackReason(reason: string | null) {
  switch (reason) {
    case 'provider_unavailable':
      return 'AI 設定が未構成のためルール要約を表示しています。';
    case 'no_other_professional_messages':
      return '他職種投稿が未検出のためルール要約を表示しています。';
    case 'upstream_error':
      return 'AI 要約で upstream error が発生したためルール要約を表示しています。';
    case 'empty_response':
      return 'AI 要約の応答が空だったためルール要約を表示しています。';
    case 'endpoint_not_allowed':
      return '許可されていない送信先のため外部 AI 要約を無効化しています。';
    case 'unknown_error':
      return 'AI 要約で予期しない失敗が発生したためルール要約を表示しています。';
    default:
      return reason ? `AI 要約を利用できなかったためルール要約を表示しています。(${reason})` : null;
  }
}

function SummaryList({
  items,
  emptyLabel,
  hideWhenEmpty = false,
}: {
  items: string[];
  emptyLabel: string;
  hideWhenEmpty?: boolean;
}) {
  if (hideWhenEmpty && items.length === 0) {
    return null;
  }

  return (
    items.length === 0 ? (
      <p className="text-xs text-muted-foreground">{emptyLabel}</p>
    ) : (
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
            {item}
          </li>
        ))}
      </ul>
    )
  );
}

export function PatientMcsSummaryCard({
  summary,
  title = 'MCS共有要点',
  description = '他職種の投稿から、確認事項と次アクションを短く整理しています。',
  compact = false,
}: {
  summary: PatientMcsViewSummary;
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  const bullets = summary.bullets.slice(0, compact ? 2 : 3);
  const mustCheckToday = summary.mustCheckToday.slice(0, compact ? 2 : 4);
  const suggestedActions = summary.suggestedActions.slice(0, compact ? 2 : 4);
  const sections = [
    {
      key: 'bullets',
      icon: CheckCircle2,
      label: '共有要点',
      items: bullets,
      emptyLabel: '共有要点はまだ生成されていません。',
    },
    {
      key: 'must-check',
      icon: AlertTriangle,
      label: '本日確認',
      items: mustCheckToday,
      emptyLabel: '本日確認の抽出はありません。',
    },
    {
      key: 'actions',
      icon: ClipboardList,
      label: '業務アクション',
      items: suggestedActions,
      emptyLabel: '追加アクション候補はありません。',
    },
  ].filter((section) => !compact || section.items.length > 0);

  return (
    <Card className="border-sky-200/80 bg-sky-50/40">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-sky-600" aria-hidden="true" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={summary.provider === 'openai' && !summary.isFallback ? 'default' : 'outline'}>
              {summary.provider === 'openai' && !summary.isFallback ? 'AI短文化' : 'ルール要約'}
            </Badge>
            <Badge variant="outline">他職種 {summary.otherProfessionalMessageCount} 件</Badge>
            <Badge variant="outline">全体 {summary.messageCount} 件</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-sky-200/80 bg-white/80 p-4">
          <p className="text-sm font-medium text-foreground">{summary.headline}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>生成 {formatDateTime(summary.generatedAt)}</span>
            {summary.latestPostedAt ? <span>直近投稿 {formatDateTime(summary.latestPostedAt)}</span> : null}
            {summary.model ? <span>{summary.requestedProvider} / {summary.model}</span> : <span>{summary.requestedProvider}</span>}
          </div>
          {summary.isFallback ? (
            <p className="mt-2 text-xs text-amber-700">
              {describeFallbackReason(summary.fallbackReason)}
            </p>
          ) : null}
        </div>

        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            要点抽出はまだありません。次回同期後に更新します。
          </p>
        ) : (
        <div className={compact ? 'grid gap-4' : 'grid gap-4 xl:grid-cols-3'}>
          {sections.length > 0 ? (
            sections.map((section) => {
              const Icon = section.icon;
              return (
                <div key={section.key} className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Icon className="size-3.5" aria-hidden="true" />
                    {section.label}
                  </div>
                  <SummaryList
                    items={section.items}
                    emptyLabel={section.emptyLabel}
                    hideWhenEmpty={compact}
                  />
                </div>
              );
            })
          ) : compact ? (
            <p className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-muted-foreground">
              要点抽出はまだありません。次回同期後に更新します。
            </p>
          ) : null}
        </div>
        )}

        {!compact && summary.sourceRefs.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">参照元</p>
            <div className="flex flex-wrap gap-2">
              {summary.sourceRefs.map((item) => (
                <Badge key={item} variant="secondary">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
