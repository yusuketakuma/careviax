'use client';

import * as React from 'react';
import { AlertTriangle, Eye, OctagonAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useUIStore } from '@/lib/stores/ui-store';
import { cn } from '@/lib/utils';

const WORKSPACE_ACTION_RAIL_DRAWER_ID = 'workspace-action-rail-drawer';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

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
        <Button asChild className="w-full" disabled={actionDisabled}>
          <a href={actionHref}>{actionLabel}</a>
        </Button>
      ) : (
        <Button type="button" className="w-full" onClick={onAction} disabled={actionDisabled}>
          {actionLabel}
        </Button>
      )}
      {secondaryActionLabel ? (
        <Button
          type="button"
          variant="outline"
          className="w-full text-primary hover:text-primary"
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

/**
 * カテゴリ→ロール識別色(患者/事務/医療機関)。--role-* 識別トークン(status ではない)。
 * chip は小チップ(最小 fill + text)、container は色パネルを使わず左ボーダー帯で示す
 * (role は text/border/dot/小チップのみ・大面積塗り禁止、§L311-317)。未知は中立トーン。
 */
const BLOCKED_CATEGORY_TONES: Record<string, BlockedCategoryTone> = {
  患者: {
    chip: 'bg-role-patient/10 text-role-patient',
    container: 'border-l-4 border-l-role-patient',
  },
  事務: { chip: 'bg-role-clerk/10 text-role-clerk', container: 'border-l-4 border-l-role-clerk' },
  医療機関: {
    chip: 'bg-role-institution/10 text-role-institution',
    container: 'border-l-4 border-l-role-institution',
  },
};

const BLOCKED_CATEGORY_DEFAULT_TONE: BlockedCategoryTone = {
  chip: 'bg-muted text-muted-foreground',
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
                    reason.severity === 'critical' ? 'text-state-blocked' : 'text-state-confirm',
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
              <span className="min-w-0 text-sm leading-5 text-foreground">{item.label}</span>
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

export type GuardedWorkspaceActionRailProps = WorkspaceActionRailProps & {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  loadingTestId: string;
  loadingAriaLabel: string;
  errorTitle?: string;
  errorDescription?: string;
  errorDetail?: React.ReactNode;
};

export function GuardedWorkspaceActionRail({
  isLoading,
  isError,
  onRetry,
  loadingTestId,
  loadingAriaLabel,
  errorTitle = '稼働状況を取得できませんでした',
  errorDescription = '次にやることと止まっている理由を表示できていません。問題なしではなく取得エラーです。再試行してください。',
  errorDetail,
  ...railProps
}: GuardedWorkspaceActionRailProps) {
  if (isLoading || isError) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        {isLoading ? (
          <div
            className="space-y-3"
            role="status"
            aria-label={loadingAriaLabel}
            data-testid={loadingTestId}
          >
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <ErrorState
            variant="server"
            title={errorTitle}
            description={errorDescription}
            detail={errorDetail}
            onRetry={onRetry}
          />
        )}
      </div>
    );
  }

  return <WorkspaceActionRail {...railProps} />;
}

/**
 * 補助パネルの標準構成。上から「次にやること」→「止まっている理由」→「根拠・記録」。
 * 画面本体を圧迫しないよう、上部バーから開く右ドロワーとして表示する。
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
  const {
    workspaceRailOpen,
    setWorkspaceRailOpen,
    registerWorkspaceRail,
    unregisterWorkspaceRail,
  } = useUIStore();
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    registerWorkspaceRail();
    return unregisterWorkspaceRail;
  }, [registerWorkspaceRail, unregisterWorkspaceRail]);

  React.useEffect(() => {
    if (!workspaceRailOpen) return undefined;

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      const drawer = document.getElementById(WORKSPACE_ACTION_RAIL_DRAWER_ID);
      if (!drawer) return;

      if (event.key === 'Escape') {
        setWorkspaceRailOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) =>
          !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
      );

      if (focusable.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const focusPanel = window.requestAnimationFrame(() => {
      const drawer = document.getElementById(WORKSPACE_ACTION_RAIL_DRAWER_ID);
      const closeButton = drawer?.querySelector<HTMLElement>('[data-slot="sheet-close"]');
      (closeButton ?? drawer)?.focus();
    });

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.cancelAnimationFrame(focusPanel);
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      const returnTarget = returnFocusRef.current;
      if (returnTarget && document.contains(returnTarget)) {
        returnTarget.focus();
      }
      returnFocusRef.current = null;
    };
  }, [setWorkspaceRailOpen, workspaceRailOpen]);

  const railContent = (
    <div className={cn('space-y-4', className)} data-testid="workspace-action-rail">
      {nextAction ? <NextActionPanel {...nextAction} /> : null}
      <BlockedReasonsPanel reasons={blockedReasons} emptyLabel={blockedReasonsEmptyLabel} />
      <EvidencePanel items={evidence} openLabel={evidenceOpenLabel} />
      {children}
    </div>
  );

  return (
    <Sheet modal={false} open={workspaceRailOpen} onOpenChange={setWorkspaceRailOpen}>
      <SheetContent
        side="right"
        id={WORKSPACE_ACTION_RAIL_DRAWER_ID}
        className="w-[min(420px,92vw)] overflow-y-auto p-0"
        data-testid="workspace-action-rail-drawer"
        closeLabel="補助パネルを閉じる"
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            setWorkspaceRailOpen(false);
          }
        }}
      >
        <SheetHeader className="border-b border-border/70 px-4 py-3">
          <SheetTitle>補助パネル</SheetTitle>
        </SheetHeader>
        <div className="p-4">{railContent}</div>
      </SheetContent>
    </Sheet>
  );
}
