'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  FileStack,
  MessageSquareMore,
  Package2,
  Pill,
  Send,
  Sparkles,
  UserCog,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StateBadge } from '@/components/ui/state-badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import type {
  VisitBrief,
  VisitBriefMedicationChange,
  VisitBriefPatientChangeType,
  VisitBriefSeverity,
} from '@/types/visit-brief';

// 重要度バッジの状態色写像(PRIORITY 軸: urgent→blocked/high→confirm/normal→info/low→readonly)
function severityClass(severity: VisitBriefSeverity) {
  switch (severity) {
    case 'urgent':
      return 'border-state-blocked/30 bg-state-blocked/10 text-state-blocked';
    case 'high':
      return 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm';
    case 'low':
      return 'border-state-readonly/30 bg-state-readonly/10 text-state-readonly';
    default:
      return 'border-tag-info/30 bg-tag-info/10 text-tag-info';
  }
}

// 前回訪問差分のバッジ(色のみ依存せずラベル併用。変更=要確認、追加/解除は情報タグ)
const PATIENT_CHANGE_TYPE_META: Record<
  VisitBriefPatientChangeType,
  { label: string; className: string }
> = {
  added: { label: '追加', className: 'border-tag-info/30 bg-tag-info/10 text-tag-info' },
  removed: {
    label: '解除',
    className: 'border-state-readonly/30 bg-state-readonly/10 text-state-readonly',
  },
  changed: {
    label: '変更',
    className: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  },
};

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
    brief.ai_summary.provider === 'openai' && !brief.ai_summary.is_fallback ? 'compare' : 'rule',
  );
  const [feedbackState, setFeedbackState] = useState<{
    ai?: 'helpful' | 'needs_review';
    rule?: 'helpful' | 'needs_review';
  }>({});
  const medicationChanges = brief.medication_changes.slice(0, compact ? 3 : 5);
  const duplicateMedicationChangeNames = findDuplicateMedicationChangeNames(medicationChanges);
  const patientChanges = brief.patient_changes.slice(0, compact ? 3 : 6);
  const dispensingItems = brief.dispensing_items.slice(0, compact ? 3 : 5);
  // その他薬(セット外で持参)は slice 前の全明細から拾う(PRN/外用/冷所が件数上限で漏れないように)。
  const outsideMedItems = brief.dispensing_items.filter((item) => item.outside_med_kind);
  const deliveryItems = brief.delivery_status.slice(0, compact ? 3 : 4);
  const dosageSupport = brief.dosage_form_support.slice(0, compact ? 3 : 4);
  const communicationItems = brief.multidisciplinary_updates.slice(0, compact ? 3 : 4);
  const jahisRecords = brief.jahis_supplemental_records.slice(0, compact ? 3 : 4);
  const latestLabs = brief.latest_labs.slice(0, compact ? 4 : 6);
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
          requested_provider: summaryKind === 'ai' ? brief.ai_summary.requested_provider : 'rule',
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
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-tag-info" aria-hidden="true" />
              {title}
              {brief.patient.archive?.archived ? (
                <StateBadge role="readonly" className="text-[11px] font-bold">
                  アーカイブ中
                </StateBadge>
              ) : null}
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
              onFeedback={(rating) => feedbackMutation.mutate({ summaryKind: 'ai', rating })}
            />
            <SummaryPanel
              kind="rule"
              heading="ルール要約"
              headline={brief.rule_summary.headline}
              bullets={brief.rule_summary.bullets}
              sourceRefs={brief.rule_summary.source_refs}
              generatedAt={brief.rule_summary.generated_at}
              metadata={[
                'rule_based_projection',
                `id ${brief.rule_summary.generation_id.slice(0, 8)}`,
              ]}
              feedbackValue={feedbackState.rule}
              onFeedback={(rating) => feedbackMutation.mutate({ summaryKind: 'rule', rating })}
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
            metadata={[
              'rule_based_projection',
              `id ${brief.rule_summary.generation_id.slice(0, 8)}`,
            ]}
            feedbackValue={feedbackState.rule}
            onFeedback={(rating) => feedbackMutation.mutate({ summaryKind: 'rule', rating })}
          />
        )}

        {brief.conference_summary ? (
          <div className="rounded-xl border border-border bg-muted/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Conference Context
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {brief.conference_summary.last_conference_type ?? '最近の会議'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  会議 {brief.conference_summary.recent_conferences} 件
                </Badge>
                <Badge
                  variant={
                    brief.conference_summary.pending_action_items > 0 ? 'secondary' : 'outline'
                  }
                >
                  未転記アクション {brief.conference_summary.pending_action_items}
                </Badge>
              </div>
            </div>
            {brief.conference_summary.summary ? (
              <p className="mt-3 text-sm leading-6 text-foreground">
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
                  <li
                    key={item}
                    className="rounded-lg border border-border/70 bg-background px-3 py-2"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="最新検査値" icon={Activity}>
            {latestLabs.length === 0 ? (
              <p className="text-xs text-muted-foreground">薬学判断に使う検査値は未登録です。</p>
            ) : (
              <ul className="space-y-2">
                {latestLabs.map((item) => (
                  <li
                    key={`${item.analyte_code}:${item.measured_at}`}
                    className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">{item.analyte_label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          測定日 {item.measured_at_label}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {item.abnormal ? (
                          <Badge
                            variant="outline"
                            className="border-state-confirm/30 bg-state-confirm/10 text-state-confirm"
                          >
                            異常{item.abnormal_flag ? ` ${item.abnormal_flag}` : ''}
                          </Badge>
                        ) : null}
                        {item.stale ? (
                          <Badge
                            variant="outline"
                            className="border-state-readonly/30 bg-state-readonly/10 text-state-readonly"
                          >
                            測定日確認
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-foreground">{item.value_label}</p>
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
                {medicationChanges.map((item, index) => (
                  <li
                    key={`${item.drug_code ?? 'unresolved'}:${item.drug_name}:${item.change_type}:${index}`}
                    className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{item.drug_name}</p>
                      {item.drug_code && duplicateMedicationChangeNames.has(item.drug_name) ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {item.drug_code}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.previous ? `${item.previous} → ` : ''}
                      {item.current}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="前回訪問からの変更" icon={UserCog}>
            {patientChanges.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                前回訪問以降の患者情報変更はありません。
              </p>
            ) : (
              <ul className="space-y-2">
                {patientChanges.map((item, index) => {
                  const meta = PATIENT_CHANGE_TYPE_META[item.change_type];
                  const detail =
                    item.previous && item.current
                      ? `${item.previous} → ${item.current}`
                      : (item.previous ?? item.current ?? '');
                  return (
                    <li
                      key={`${item.category}:${item.field_label}:${item.change_type}:${index}`}
                      className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-foreground">{item.field_label}</p>
                        <Badge variant="outline" className={cn('shrink-0 text-xs', meta.className)}>
                          {meta.label}
                        </Badge>
                      </div>
                      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="調剤方法" icon={Package2}>
            {dispensingItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">調剤方法の追記はありません。</p>
            ) : (
              <ul className="space-y-2">
                {dispensingItems.map((item) => (
                  <li
                    key={`${item.drug_name}:${item.note}`}
                    className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-foreground">{item.drug_name}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {outsideMedItems.length > 0 ? (
            <Section title="その他薬（セット外で持参）" icon={Pill}>
              <ul className="space-y-2">
                {outsideMedItems.map((item, index) => (
                  <li
                    key={`${item.drug_name}:${item.outside_med_kind}:${index}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    {/* 分類はラベル(テキスト)で示し色のみに依存しない(WCAG AA)。 */}
                    <Badge variant="outline">{item.outside_med_label}</Badge>
                    <span className="font-medium text-foreground">{item.drug_name}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="送達・共有状態" icon={Send}>
            {deliveryItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">送達確認が必要な共有はありません。</p>
            ) : (
              <ul className="space-y-2">
                {deliveryItems.map((item) => (
                  <li
                    key={`${item.title}:${item.occurred_at ?? 'none'}`}
                    className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <Badge variant={item.status_bucket === 'failed' ? 'destructive' : 'outline'}>
                        {item.status_bucket}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
                    {item.action_href ? (
                      <Link
                        href={item.action_href}
                        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        共有を確認
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    ) : null}
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
                  <li
                    key={`${item.category}:${item.drug_name ?? 'none'}`}
                    className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {item.drug_name ?? '対象薬未特定'}
                      </p>
                      <Badge variant="outline">{item.category}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.reason}</p>
                    {item.caution ? (
                      <p className="mt-1 text-[11px] leading-5 text-state-confirm">
                        {item.caution}
                      </p>
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
                  <li
                    key={`${item.source_type}:${item.title}:${item.occurred_at ?? 'none'}`}
                    className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                          severityClass(item.severity),
                        )}
                      >
                        {item.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
                    {item.action_href ? (
                      <Link
                        href={item.action_href}
                        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {item.action_label ?? '依頼を確認'}
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="JAHIS補足情報" icon={FileStack}>
            {jahisRecords.length === 0 ? (
              <p className="text-xs text-muted-foreground">QR由来の補足情報はありません。</p>
            ) : (
              <ul className="space-y-2">
                {jahisRecords.map((item) => (
                  <li
                    key={`${item.record_type}:${item.id}`}
                    className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">{item.record_label}</p>
                      <Badge variant="outline">{item.record_type}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.summary ?? item.raw_line}
                    </p>
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
                <div
                  key={`${item.source_type}:${item.title}`}
                  className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                        severityClass(item.severity),
                      )}
                    >
                      {item.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
                  <Link
                    href={item.href}
                    className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    確認する
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function findDuplicateMedicationChangeNames(items: VisitBriefMedicationChange[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.drug_name, (counts.get(item.drug_name) ?? 0) + 1);
  }
  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([drugName]) => drugName),
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
        kind === 'ai' ? 'border-tag-info/30 bg-tag-info/5' : 'border-border bg-muted/50',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {heading}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">{headline}</p>
        </div>
        <Badge variant={kind === 'ai' ? 'default' : 'outline'}>
          {kind === 'ai' ? 'AI' : 'RULE'}
        </Badge>
      </div>
      {bullets.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-foreground">
          {bullets.map((item) => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      ) : null}
      {sourceRefs.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">根拠: {sourceRefs.join(' / ')}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {metadata.filter(Boolean).map((item) => (
          <Badge key={item} variant="secondary">
            {item}
          </Badge>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          生成 {generatedAt.slice(0, 16).replace('T', ' ')}
        </p>
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
