import * as React from 'react';
import { OctagonAlert, TriangleAlert, Info, Clock, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_TOKENS } from '@/lib/constants/status-tokens';

/**
 * 医療アラートの4段階。即時性と説明性を見た目・ARIA の両方で分離する（CDSS/EHR の知見）。
 * 同じ見た目で混在させると「赤を見たら必ず行動」という信号価値が失われる。
 * - critical : 緊急中断（赤）。患者に害が及ぶ。即対応。
 * - warning  : 要確認（橙）。判断が必要。
 * - status   : 状態（中立）。記録上の状態。行動を促さない。
 * - reminder : 期限リマインダー（青）。先の予定・締切の予告。
 */
export type AlertTierLevel = 'critical' | 'warning' | 'status' | 'reminder';

type TierSpec = {
  icon: LucideIcon;
  /** 左ボーダーの色トークン（SSOT: STATUS_TOKENS.accentClassName。全面塗りしない）。 */
  accent: string;
  iconColor: string;
  /**
   * critical のみ即時告知(assertive=role=alert)。
   * warning/reminder は polite(role=status) で過告知を避ける。status は告知しない。
   */
  ariaRole?: 'alert' | 'status';
  /** 既定の見出し（title 未指定時）。 */
  defaultTitle: string;
};

const TIER: Record<AlertTierLevel, TierSpec> = {
  critical: {
    icon: OctagonAlert,
    accent: STATUS_TOKENS.blocked.accentClassName,
    iconColor: 'text-state-blocked',
    ariaRole: 'alert',
    defaultTitle: '緊急',
  },
  warning: {
    icon: TriangleAlert,
    accent: STATUS_TOKENS.confirm.accentClassName,
    iconColor: 'text-state-confirm',
    // 静的な「要確認」が assertive で割り込むのは過告知。polite に留める。
    ariaRole: 'status',
    defaultTitle: '要確認',
  },
  status: {
    icon: Info,
    accent: 'border-l-foreground/20',
    iconColor: 'text-muted-foreground',
    ariaRole: undefined,
    defaultTitle: '状態',
  },
  reminder: {
    icon: Clock,
    accent: STATUS_TOKENS.info.accentClassName,
    iconColor: 'text-tag-info',
    ariaRole: 'status',
    defaultTitle: 'リマインダー',
  },
};

export type AlertTierProps = {
  level: AlertTierLevel;
  /** 見出し。未指定なら段階の既定見出し。 */
  title?: React.ReactNode;
  /** 本文・補足。 */
  children?: React.ReactNode;
  /** 右側に置く操作（解消導線など）。 */
  action?: React.ReactNode;
  className?: string;
};

/**
 * 段階別アラート。背景全面塗りを避け、左ボーダー＋色付きアイコン＋見出しで段階を区別する。
 * ARIA の live region も段階で出し分け、status は告知しない（assertive の濫用を是正）。
 */
export function AlertTier({ level, title, children, action, className }: AlertTierProps) {
  const spec = TIER[level];
  const Icon = spec.icon;
  return (
    <div
      role={spec.ariaRole}
      data-level={level}
      className={cn(
        'flex items-start gap-3 rounded-md border border-l-4 bg-card p-3 text-sm ring-1 ring-foreground/10',
        spec.accent,
        className,
      )}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', spec.iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title ?? spec.defaultTitle}</p>
        {children ? <div className="mt-0.5 text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
