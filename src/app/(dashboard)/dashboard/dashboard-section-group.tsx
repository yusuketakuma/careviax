import { cn } from '@/lib/utils';

type DashboardSectionGroupProps = {
  id: string;
  eyebrow?: string;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
};

export function DashboardSectionGroup({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
  contentClassName,
}: DashboardSectionGroupProps) {
  return (
    <section
      aria-labelledby={id}
      className={cn('rounded-2xl border border-border/70 bg-card shadow-sm', className)}
    >
      <div className="border-b border-border/70 px-5 py-4 sm:px-6">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <div className={cn('space-y-1', eyebrow ? 'mt-2' : null)}>
          <h2 id={id} className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className={cn('px-5 py-5 sm:px-6 sm:py-6', contentClassName)}>{children}</div>
    </section>
  );
}
