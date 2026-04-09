'use client';

import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  FileStack,
  MessageSquareMore,
  Package2,
  Pill,
  Send,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import type { VisitBrief, VisitBriefSeverity } from '@/types/visit-brief';

function severityClass(severity: VisitBriefSeverity) {
  switch (severity) {
    case 'urgent':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'high':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'low':
      return 'border-slate-200 bg-slate-50 text-slate-600';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-700';
  }
}

export function VisitBriefCard({
  brief,
  title = 'AI訪問要点サマリー',
  description = '処方・調剤・多職種情報をまとめて確認できます。',
  compact = false,
}: {
  brief: VisitBrief;
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  const orgId = useOrgId();
  const [summaryMode, setSummaryMode] = useState<'compare' | 'ai' | 'rule'>(
    brief.ai_summary.provider === 'openai' && !brief.ai_summary.is_fallback ? 'compare' : 'rule'
  );
  const [feedbackState, setFeedbackState] = useState<{
    ai?: 'helpful' | 'needs_review';
    rule?: 'helpful' | 'needs_review';
  }>({});
  const medicationChanges = brief.medication_changes.slice(0, compact ? 3 : 5);
  const dispensingItems = brief.dispensing_items.slice(0, compact ? 3 : 5);
  const deliveryItems = brief.delivery_status.slice(0, compact ? 3 : 4);
  const dosageSupport = brief.dosage_form_support.slice(0, compact ? 3 : 4);
  const communicationItems = brief.multidisciplinary_updates.slice(0, compact ? 3 : 4);
  const unresolvedItems = brief.unresolved_items.slice(0, compact ? 3 : 4);
  const feedbackMutation = useMutation({
    mutationFn: async ({
      summaryKind,
      rating,
    }: {
      summaryKind: 'ai' | 'rule';
      rating: 'helpful' | 'needs_review';
    }) => {
      const res = await fetch('/api/visit-brief-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          patient_id: brief.patient.id,
          context: brief.context,
          generation_id:
            summaryKind === 'ai'
              ? brief.ai_summary.generation_id
              : brief.rule_summary.generation_id,
          summary_kind: summaryKind,
          rating,
          provider: summaryKind === 'ai' ? brief.ai_summary.provider : 'rule',
          requested_provider:
            summaryKind === 'ai' ? brief.ai_summary.requested_provider : 'rule',
          model: summaryKind === 'ai' ? brief.ai_summary.model : null,
          is_fallback: summaryKind === 'ai' ? brief.ai_summary.is_fallback : false,
        }),
      });
      if (!res.ok) throw new Error('フィードバック送信に失敗しました');
    },
    onSuccess: (_data, variables) => {
      setFeedbackState((current) => ({
        ...current,
        [variables.summaryKind]: variables.rating,
      }));
      toast.success('要約フィードバックを保存しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'フィードバック送信に失敗しました');
    },
  });

  return (
    <Card className="border-slate-200 shadow-sm">
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
            <Badge variant={brief.ai_summary.provider === 'openai' ? 'default' : 'outline'}>
              {brief.ai_summary.provider === 'openai' ? 'AI短文化' : 'ルール要約'}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant={summaryMode === 'compare' ? 'default' : 'outline'}
              onClick={() => setSummaryMode('compare')}
            >
              比較
            </Button>
            <Button
              type="button"
              size="sm"
              variant={summaryMode === 'ai' ? 'default' : 'outline'}
              onClick={() => setSummaryMode('ai')}
            >
              AI
            </Button>
            <Button
              type="button"
              size="sm"
              variant={summaryMode === 'rule' ? 'default' : 'outline'}
              onClick={() => setSummaryMode('rule')}
            >
              ルール
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {summaryMode === 'compare' ? (
          <div className="grid gap-3 xl:grid-cols-2">
            <SummaryPanel
              kind="ai"
              heading="AI短文化"
              headline={brief.ai_summary.headline}
              bullets={brief.ai_summary.bullets}
              sourceRefs={brief.ai_summary.source_refs}
              generatedAt={brief.ai_summary.generated_at}
              metadata={[
                `${brief.ai_summary.requested_provider}${brief.ai_summary.model ? ` / ${brief.ai_summary.model}` : ''}`,
                brief.ai_summary.is_fallback
                  ? `fallback / ${brief.ai_summary.fallback_reason ?? 'provider_unavailable'}`
                  : 'ai_active',
                brief.ai_summary.duration_ms != null
                  ? `${brief.ai_summary.duration_ms}ms`
                  : 'duration n/a',
                brief.ai_summary.recent_failure_rate_24h != null
                  ? `24h失敗率 ${brief.ai_summary.recent_failure_rate_24h}% (${brief.ai_summary.recent_failure_count_24h}/${brief.ai_summary.recent_generation_count_24h})`
                  : '24h集計なし',
              ]}
              feedbackValue={feedbackState.ai}
              onFeedback={(rating) =>
                feedbackMutation.mutate({ summaryKind: 'ai', rating })
              }
            />
            <SummaryPanel
              kind="rule"
              heading="ルール要約"
              headline={brief.rule_summary.headline}
              bullets={brief.rule_summary.bullets}
              sourceRefs={brief.rule_summary.source_refs}
              generatedAt={brief.rule_summary.generated_at}
              metadata={['rule_based_projection', `id ${brief.rule_summary.generation_id.slice(0, 8)}`]}
              feedbackValue={feedbackState.rule}
              onFeedback={(rating) =>
                feedbackMutation.mutate({ summaryKind: 'rule', rating })
              }
            />
          </div>
        ) : summaryMode === 'ai' ? (
          <SummaryPanel
            kind="ai"
            heading="AI短文化"
            headline={brief.ai_summary.headline}
            bullets={brief.ai_summary.bullets}
            sourceRefs={brief.ai_summary.source_refs}
            generatedAt={brief.ai_summary.generated_at}
            metadata={[
              `${brief.ai_summary.requested_provider}${brief.ai_summary.model ? ` / ${brief.ai_summary.model}` : ''}`,
              brief.ai_summary.is_fallback
                ? `fallback / ${brief.ai_summary.fallback_reason ?? 'provider_unavailable'}`
                : 'ai_active',
              brief.ai_summary.recent_failure_rate_24h != null
                ? `24h失敗率 ${brief.ai_summary.recent_failure_rate_24h}%`
                : '24h集計なし',
            ]}
            feedbackValue={feedbackState.ai}
            onFeedback={(rating) => feedbackMutation.mutate({ summaryKind: 'ai', rating })}
          />
        ) : (
          <SummaryPanel
            kind="rule"
            heading="ルール要約"
            headline={brief.rule_summary.headline}
            bullets={brief.rule_summary.bullets}
            sourceRefs={brief.rule_summary.source_refs}
            generatedAt={brief.rule_summary.generated_at}
            metadata={['rule_based_projection', `id ${brief.rule_summary.generation_id.slice(0, 8)}`]}
            feedbackValue={feedbackState.rule}
            onFeedback={(rating) => feedbackMutation.mutate({ summaryKind: 'rule', rating })}
          />
        )}

        {brief.conference_summary ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Conference Context
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-950">
                  {brief.conference_summary.last_conference_type ?? '最近の会議'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  会議 {brief.conference_summary.recent_conferences} 件
                </Badge>
                <Badge
                  variant={
                    brief.conference_summary.pending_action_items > 0
                      ? 'secondary'
                      : 'outline'
                  }
                >
                  未転記アクション {brief.conference_summary.pending_action_items}
                </Badge>
              </div>
            </div>
            {brief.conference_summary.summary ? (
              <p className="mt-3 text-sm leading-6 text-slate-900">
                {brief.conference_summary.summary}
              </p>
            ) : null}
            {brief.conference_summary.highlighted_risks.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {brief.conference_summary.highlighted_risks.map((risk) => (
                  <Badge key={risk} variant="secondary">
                    {risk}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={cn('grid gap-3', compact ? 'lg:grid-cols-2' : 'xl:grid-cols-2')}>
          <Section title="本日確認" icon={AlertTriangle}>
            {brief.must_check_today.length === 0 ? (
              <p className="text-xs text-muted-foreground">確認事項はありません。</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {brief.must_check_today.slice(0, compact ? 4 : 6).map((item) => (
                  <li key={item} className="rounded-lg border border-border/70 bg-background px-3 py-2">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="処方変更" icon={FileStack}>
            {medicationChanges.length === 0 ? (
              <p className="text-xs text-muted-foreground">直近の処方変更はありません。</p>
            ) : (
              <ul className="space-y-2">
                {medicationChanges.map((item) => (
                  <li key={`${item.drug_name}:${item.change_type}`} className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                    <p className="font-medium text-foreground">{item.drug_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.previous ? `${item.previous} → ` : ''}
                      {item.current}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="調剤方法" icon={Package2}>
            {dispensingItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">調剤方法の追記はありません。</p>
            ) : (
              <ul className="space-y-2">
                {dispensingItems.map((item) => (
                  <li key={`${item.drug_name}:${item.note}`} className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                    <p className="font-medium text-foreground">{item.drug_name}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="送達・共有状態" icon={Send}>
            {deliveryItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">送達確認が必要な共有はありません。</p>
            ) : (
              <ul className="space-y-2">
                {deliveryItems.map((item) => (
                  <li key={`${item.title}:${item.occurred_at ?? 'none'}`} className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <Badge variant={item.status_bucket === 'failed' ? 'destructive' : 'outline'}>
                        {item.status_bucket}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="剤形・服用支援候補" icon={Pill}>
            {dosageSupport.length === 0 ? (
              <p className="text-xs text-muted-foreground">追加の剤形支援候補はありません。</p>
            ) : (
              <ul className="space-y-2">
                {dosageSupport.map((item) => (
                  <li key={`${item.category}:${item.drug_name ?? 'none'}`} className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {item.drug_name ?? '対象薬未特定'}
                      </p>
                      <Badge variant="outline">{item.category}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.reason}</p>
                    {item.caution ? (
                      <p className="mt-1 text-[11px] leading-5 text-amber-700">{item.caution}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="多職種・家族からの更新" icon={MessageSquareMore}>
            {communicationItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">新しい共有はありません。</p>
            ) : (
              <ul className="space-y-2">
                {communicationItems.map((item) => (
                  <li key={`${item.source_type}:${item.title}:${item.occurred_at ?? 'none'}`} className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', severityClass(item.severity))}>
                        {item.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {unresolvedItems.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">未解決事項</p>
            <div className="grid gap-2 lg:grid-cols-2">
              {unresolvedItems.map((item) => (
                <div key={`${item.source_type}:${item.title}`} className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', severityClass(item.severity))}>
                      {item.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof AlertTriangle;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
      </p>
      {children}
    </section>
  );
}

function SummaryPanel({
  kind,
  heading,
  headline,
  bullets,
  sourceRefs,
  generatedAt,
  metadata,
  feedbackValue,
  onFeedback,
}: {
  kind: 'ai' | 'rule';
  heading: string;
  headline: string;
  bullets: string[];
  sourceRefs: string[];
  generatedAt: string;
  metadata: string[];
  feedbackValue?: 'helpful' | 'needs_review';
  onFeedback: (rating: 'helpful' | 'needs_review') => void;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        kind === 'ai' ? 'border-sky-200 bg-sky-50/70' : 'border-slate-200 bg-slate-50/80'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {heading}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-950">{headline}</p>
        </div>
        <Badge variant={kind === 'ai' ? 'default' : 'outline'}>
          {kind === 'ai' ? 'AI' : 'RULE'}
        </Badge>
      </div>
      {bullets.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-slate-900">
          {bullets.map((item) => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      ) : null}
      {sourceRefs.length > 0 ? (
        <p className="mt-3 text-xs text-slate-700/80">根拠: {sourceRefs.join(' / ')}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-800/80">
        {metadata.filter(Boolean).map((item) => (
          <Badge key={item} variant="secondary" className="bg-white/80 text-slate-900">
            {item}
          </Badge>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-700/80">生成 {generatedAt.slice(0, 16).replace('T', ' ')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={feedbackValue === 'helpful' ? 'default' : 'outline'}
            onClick={() => onFeedback('helpful')}
          >
            実用的
          </Button>
          <Button
            type="button"
            size="sm"
            variant={feedbackValue === 'needs_review' ? 'default' : 'outline'}
            onClick={() => onFeedback('needs_review')}
          >
            要修正
          </Button>
        </div>
      </div>
    </div>
  );
}
