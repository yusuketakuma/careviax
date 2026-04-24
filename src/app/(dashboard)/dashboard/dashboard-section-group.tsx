import { HelpPopover } from '@/components/ui/help-popover';
import { cn } from '@/lib/utils';

type DashboardSectionGroupProps = {
  id: string;
  eyebrow?: string;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  tone?: 'default' | 'daily' | 'workflow' | 'monitoring' | 'reference';
};

const TONE_STYLES = {
  default: {
    root: 'border-border/70 bg-card shadow-sm',
    header: 'bg-transparent',
    eyebrow: 'border-border/70 bg-muted/35 text-muted-foreground',
  },
  daily: {
    root: 'border-primary/15 bg-card shadow-sm',
    header: 'bg-primary/[0.045]',
    eyebrow: 'border-primary/15 bg-primary/[0.08] text-primary',
  },
  workflow: {
    root: 'border-emerald-200/80 bg-card shadow-sm',
    header: 'bg-emerald-500/[0.05]',
    eyebrow: 'border-emerald-200/80 bg-emerald-500/[0.10] text-emerald-800',
  },
  monitoring: {
    root: 'border-amber-200/80 bg-card shadow-sm',
    header: 'bg-amber-500/[0.05]',
    eyebrow: 'border-amber-200/80 bg-amber-500/[0.10] text-amber-900',
  },
  reference: {
    root: 'border-border/70 bg-card shadow-sm',
    header: 'bg-muted/30',
    eyebrow: 'border-border/70 bg-background/80 text-muted-foreground',
  },
} as const;

export function DashboardSectionGroup({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
  contentClassName,
  tone = 'default',
}: DashboardSectionGroupProps) {
  const toneStyles = TONE_STYLES[tone];

  return (
    <section
      aria-labelledby={id}
      className={cn('overflow-hidden rounded-2xl border', toneStyles.root, className)}
    >
      <div className={cn('border-b border-border/70 px-5 py-4 sm:px-6', toneStyles.header)}>
        {eyebrow ? (
          <p
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
              toneStyles.eyebrow,
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <div className={cn('space-y-1', eyebrow ? 'mt-2' : null)}>
          <div className="flex items-center gap-2">
            <h2 id={id} className="text-lg font-semibold text-foreground">
              {title}
            </h2>
            <HelpPopover title={title} description={description} />
          </div>
        </div>
      </div>
      <div className={cn('px-5 py-5 sm:px-6 sm:py-6', contentClassName)}>{children}</div>
    </section>
  );
}
