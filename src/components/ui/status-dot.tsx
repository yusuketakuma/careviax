import { cn } from '@/lib/utils';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';

export type StatusDotProps = {
  role: StatusRole;
  /** a11y text; falls back to the role's semantic default. */
  label?: string;
  /** false (default) -> dot + sr-only label; true -> dot + visible text. */
  showLabel?: boolean;
  className?: string;
};

/**
 * Compact status indicator: a full-strength token-coloured dot that ALWAYS carries a text label
 * (visible or sr-only), so the state is never communicated by colour alone. The dot itself is a
 * decorative graphic (WCAG 1.4.11 non-text 3:1); the label provides the accessible name.
 */
export function StatusDot({ role, label, showLabel = false, className }: StatusDotProps) {
  const spec = STATUS_TOKENS[role];
  const text = label ?? spec.label;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} data-role={role}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', spec.dotClassName)} />
      {showLabel ? <span className="text-xs">{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}
