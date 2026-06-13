import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';

export type StateBadgeProps = {
  role: StatusRole;
  /** visible label; falls back to the role's semantic default. */
  children?: ReactNode;
  /** color+icon redundancy — keep true unless an adjacent icon already conveys state. */
  showIcon?: boolean;
  className?: string;
};

/**
 * Semantic status badge. Renders the central state/tag token (globals.css `--state-*`/`--tag-*`)
 * as a tinted surface + saturated text, always paired with an icon and text so colour is never
 * the only signal. Reuses the shadcn Badge; no new variants are introduced.
 */
export function StateBadge({ role, children, showIcon = true, className }: StateBadgeProps) {
  const spec = STATUS_TOKENS[role];
  const Icon = spec.icon;
  return (
    <Badge
      variant="outline"
      data-role={role}
      className={cn('gap-1 border-transparent', spec.badgeClassName, className)}
    >
      {showIcon ? <Icon aria-hidden data-icon="inline-start" /> : null}
      <span>{children ?? spec.label}</span>
    </Badge>
  );
}
