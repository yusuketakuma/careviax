'use client';

import * as React from 'react';
import { AlertTriangle, Eye, OctagonAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * design/ v1.9 の右パネル共通パターン(P0-08 基準)+ design/images/new 拡張。
 * 「次にやること」「止まっている理由」「根拠・記録」の 3 点セットを
 * 各ワークスペース画面の右レールに表示する。
 * 文言ルール: design/README_Codex.md(Next Action→次にやること 等)
 * 新デザイン拡張(docs/design-gap-analysis-new.md「共通パターン」):
 * - 根拠・記録: 行ごとの補足 meta(日時/種別)と行アクション文言差し替え(見る/開く)。
 * - 止まっている理由: カテゴリ色チップ(患者/事務/医療機関)+経過時間+個別アクションリンク。
 *   いずれも optional で、未指定の既存呼び出しは従来表示のまま。
 */

type RailCardProps = {
  title: string;
  headingId?: string;
  children: React.ReactNode;
  className?: string;
  'data-testid'?: string;
};

function RailCard({ title, headingId, children, className, ...props }: RailCardProps) {
  const generatedId = React.useId();
  const titleId = headingId ?? `${generatedId}-heading`;

  return (
    <section
      aria-labelledby={titleId}
      className={cn('space-y-3 rounded-lg border border-border/70 bg-card p-4', className)}
      data-testid={props['data-testid']}
    >
      <h3 id={titleId} className="text-sm font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export type NextActionPanelProps = {
  /** 何のために主操作へ進むのかの短い説明(例: セット監査まで進めます。) */
  description?: string;
  /** 主操作ラベル(画面ごとに 1 つだけ強く見せる) */
  actionLabel: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  /** ボタンの代わりにリンクとして描画する場合の href */
  actionHref?: string;
  /** 副操作ラベル(アウトライン・青テキスト。デザイン P0-32 の「問題なしにする」等) */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  secondaryActionDisabled?: boolean;
  className?: string;
};

export function NextActionPanel({
  description,
  actionLabel,
  onAction,
  actionDisabled = false,
  actionHref,
  secondaryActionLabel,
  onSecondaryAction,
  secondaryActionDisabled = false,
  className,
}: NextActionPanelProps) {
  return (
    <RailCard title="次にやること" className={className} data-testid="next-action-panel">
      {actionHref ? (
        <Button asChild className="min-h-[44px] w-full" disabled={actionDisabled}>
          <a href={actionHref}>{actionLabel}</a>
        </Button>
      ) : (
        <Button
          type="button"
          className="min-h-[44px] w-full"
          onClick={onAction}
          disabled={actionDisabled}
        >
          {actionLabel}
        </Button>
      )}
      {secondaryActionLabel ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] w-full text-primary hover:text-primary"
          onClick={onSecondaryAction}
          disabled={secondaryActionDisabled}
        >
          {secondaryActionLabel}
        </Button>
      ) : null}
      {description ? (
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
    </RailCard>
  );
}

export type BlockedReason = {
  id: string;
  label: string;
  /** critical=赤(重大)/ warning=橙(注意) */
  severity: 'critical' | 'warning';
  /** 新デザイン: カテゴリ色チップ(「患者」「事務」「医療機関」等)。指定時はリッチ表示になる */
  categoryLabel?: string;
  /** 新デザイン: 経過時間ラベル(「1日」「30分」等) */
  ageLabel?: string;
  /** 新デザイン: 個別アクションリンク文言(「再連絡する →」等。actionHref とセットで表示) */
  actionLabel?: string;
  /** 新デザイン: 個別アクションリンク先 */
  actionHref?: string;
};

type BlockedCategoryTone = {
  chip: string;
  container: string;
};

/** カテゴリ→色チップ/淡背景(デザイン 01/06: 患者=紫、事務=黄)。未知カテゴリは中立トーン。 */
const BLOCKED_CATEGORY_TONES: Record<string, BlockedCategoryTone> = {
  患者: { chip: 'bg-violet-100 text-violet-800', container: 'border-violet-200 bg-violet-50/70' },
  事務: { chip: 'bg-amber-100 text-amber-800', container: 'border-amber-200 bg-amber-50/70' },
  医療機関: { chip: 'bg-blue-100 text-blue-800', container: 'border-blue-200 bg-blue-50/70' },
};

const BLOCKED_CATEGORY_DEFAULT_TONE: BlockedCategoryTone = {
  chip: 'bg-slate-100 text-slate-700',
  container: 'border-border bg-muted/40',
};

export type BlockedReasonsPanelProps = {
  reasons: BlockedReason[];
  /** 理由ゼロ件のときの表示(省略時はパネル自体を出さない) */
  emptyLabel?: string;
  className?: string;
};

export function BlockedReasonsPanel({ reasons, emptyLabel, className }: BlockedReasonsPanelProps) {
  if (reasons.length === 0 && !emptyLabel) return null;

  return (
    <RailCard title="止まっている理由" className={className} data-testid="blocked-reasons-panel">
      {reasons.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2" role="list">
          {reasons.map((reason) => {
            const hasAction = Boolean(reason.actionLabel && reason.actionHref);
            const isRich = Boolean(reason.categoryLabel || reason.ageLabel || hasAction);

            if (!isRich) {
              return (
                <li
                  key={reason.id}
                  className={cn(
                    'flex items-start gap-2 text-sm leading-5',
                    reason.severity === 'critical' ? 'text-destructive' : 'text-amber-600',
                  )}
                >
                  {reason.severity === 'critical' ? (
                    <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>{reason.label}</span>
                </li>
              );
            }

            const tone = reason.categoryLabel
              ? (BLOCKED_CATEGORY_TONES[reason.categoryLabel] ?? BLOCKED_CATEGORY_DEFAULT_TONE)
              : BLOCKED_CATEGORY_DEFAULT_TONE;

            return (
              <li key={reason.id} className={cn('rounded-md border p-2.5', tone.container)}>
                <div className="flex items-start gap-2">
                  {reason.categoryLabel ? (
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
                        tone.chip,
                      )}
                    >
                      {reason.categoryLabel}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground">
                    {reason.label}
                  </span>
                  {reason.ageLabel ? (
                    <span className="shrink-0 text-xs leading-5 text-muted-foreground">
                      {reason.ageLabel}
                    </span>
                  ) : null}
                </div>
                {hasAction ? (
                  <a
                    href={reason.actionHref}
                    className="mt-1.5 inline-flex min-h-6 items-center text-sm font-medium text-primary hover:underline"
                  >
                    {reason.actionLabel}
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </RailCard>
  );
}

export type EvidenceItem = {
  id: string;
  label: string;
  /** 新デザイン: 行の補足(日時/種別 例「6/12」「09:31」「eGFR」) */
  meta?: string;
  onView?: () => void;
  href?: string;
};

export type EvidencePanelProps = {
  items: EvidenceItem[];
  /** 行アクション文言(既定「見る」。新デザインの根拠・記録では「開く」) */
  openLabel?: string;
  className?: string;
};

export function EvidencePanel({ items, openLabel = '見る', className }: EvidencePanelProps) {
  if (items.length === 0) return null;

  return (
    <RailCard title="根拠・記録" className={className} data-testid="evidence-panel">
      <ul className="divide-y divide-border/60" role="list">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
          >
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="min-w-0 truncate text-sm text-foreground">{item.label}</span>
              {item.meta ? (
                <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>
              ) : null}
            </span>
            {item.href ? (
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <a href={item.href}>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  {openLabel}
                </a>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={item.onView}
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                {openLabel}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

export type WorkspaceActionRailProps = {
  nextAction?: NextActionPanelProps;
  blockedReasons?: BlockedReason[];
  blockedReasonsEmptyLabel?: string;
  evidence?: EvidenceItem[];
  /** 根拠・記録の行アクション文言(既定「見る」。新デザインでは「開く」) */
  evidenceOpenLabel?: string;
  className?: string;
  children?: React.ReactNode;
};

/**
 * 右レールの標準構成。上から「次にやること」→「止まっている理由」→「根拠・記録」。
 * children は追加カード(画面固有の補助情報)用。
 */
export function WorkspaceActionRail({
  nextAction,
  blockedReasons = [],
  blockedReasonsEmptyLabel,
  evidence = [],
  evidenceOpenLabel,
  className,
  children,
}: WorkspaceActionRailProps) {
  return (
    <div className={cn('space-y-4', className)} data-testid="workspace-action-rail">
      {nextAction ? <NextActionPanel {...nextAction} /> : null}
      <BlockedReasonsPanel reasons={blockedReasons} emptyLabel={blockedReasonsEmptyLabel} />
      <EvidencePanel items={evidence} openLabel={evidenceOpenLabel} />
      {children}
    </div>
  );
}
