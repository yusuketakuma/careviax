import type { LucideIcon } from 'lucide-react';
import { Ban, CircleCheck, TriangleAlert, Clock, Eye, ShieldAlert, Info } from 'lucide-react';

export type StateRole = 'blocked' | 'done' | 'confirm' | 'waiting' | 'readonly';
export type TagRole = 'hazard' | 'info';
export type StatusRole = StateRole | TagRole;

export type StatusTokenSpec = {
  /** semantic default (sr-only / fallback). Never rely on color alone. */
  label: string;
  /** color+icon redundancy — state is never signalled by color only. */
  icon: LucideIcon;
  /** tinted surface + readable foreground, with token-colored ring for state redundancy. */
  badgeClassName: string;
  /** full-strength fill for StatusDot. */
  dotClassName: string;
  /**
   * full-strength left-border accent for cards/tiles/rows.
   * 状態色を「全面塗り」せず左の線で点すための SSOT。Tailwind が検出できるよう完全な静的文字列で持つ。
   */
  accentClassName: string;
};

export const STATUS_TOKENS: Record<StatusRole, StatusTokenSpec> = {
  blocked: {
    label: '止まっている理由',
    icon: Ban,
    badgeClassName: 'bg-state-blocked/15 text-foreground ring-1 ring-state-blocked/25',
    dotClassName: 'bg-state-blocked',
    accentClassName: 'border-l-state-blocked',
  },
  done: {
    label: '完了',
    icon: CircleCheck,
    badgeClassName: 'bg-state-done/15 text-foreground ring-1 ring-state-done/25',
    dotClassName: 'bg-state-done',
    accentClassName: 'border-l-state-done',
  },
  confirm: {
    label: '要確認',
    icon: TriangleAlert,
    badgeClassName: 'bg-state-confirm/15 text-foreground ring-1 ring-state-confirm/25',
    dotClassName: 'bg-state-confirm',
    accentClassName: 'border-l-state-confirm',
  },
  waiting: {
    label: '他者の確認待ち',
    icon: Clock,
    badgeClassName: 'bg-state-waiting/15 text-foreground ring-1 ring-state-waiting/25',
    dotClassName: 'bg-state-waiting',
    accentClassName: 'border-l-state-waiting',
  },
  readonly: {
    label: '閲覧のみ',
    icon: Eye,
    badgeClassName: 'bg-state-readonly/15 text-foreground ring-1 ring-state-readonly/25',
    dotClassName: 'bg-state-readonly',
    accentClassName: 'border-l-state-readonly',
  },
  hazard: {
    label: '危険',
    icon: ShieldAlert,
    badgeClassName: 'bg-tag-hazard/15 text-foreground ring-1 ring-tag-hazard/25',
    dotClassName: 'bg-tag-hazard',
    accentClassName: 'border-l-tag-hazard',
  },
  info: {
    label: '情報',
    icon: Info,
    badgeClassName: 'bg-tag-info/15 text-foreground ring-1 ring-tag-info/25',
    dotClassName: 'bg-tag-info',
    accentClassName: 'border-l-tag-info',
  },
};
