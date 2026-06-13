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
  /** tinted surface + token text (mirrors the shadcn destructive variant). */
  badgeClassName: string;
  /** full-strength fill for StatusDot. */
  dotClassName: string;
};

export const STATUS_TOKENS: Record<StatusRole, StatusTokenSpec> = {
  blocked: {
    label: '止まっている理由',
    icon: Ban,
    badgeClassName: 'bg-state-blocked/10 text-state-blocked',
    dotClassName: 'bg-state-blocked',
  },
  done: {
    label: '完了',
    icon: CircleCheck,
    badgeClassName: 'bg-state-done/10 text-state-done',
    dotClassName: 'bg-state-done',
  },
  confirm: {
    label: '要確認',
    icon: TriangleAlert,
    badgeClassName: 'bg-state-confirm/10 text-state-confirm',
    dotClassName: 'bg-state-confirm',
  },
  waiting: {
    label: '他者の確認待ち',
    icon: Clock,
    badgeClassName: 'bg-state-waiting/10 text-state-waiting',
    dotClassName: 'bg-state-waiting',
  },
  readonly: {
    label: '閲覧のみ',
    icon: Eye,
    badgeClassName: 'bg-state-readonly/10 text-state-readonly',
    dotClassName: 'bg-state-readonly',
  },
  hazard: {
    label: '危険',
    icon: ShieldAlert,
    badgeClassName: 'bg-tag-hazard/10 text-tag-hazard',
    dotClassName: 'bg-tag-hazard',
  },
  info: {
    label: '情報',
    icon: Info,
    badgeClassName: 'bg-tag-info/10 text-tag-info',
    dotClassName: 'bg-tag-info',
  },
};
