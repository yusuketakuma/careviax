import Link from 'next/link';
import type { ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  guidance?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

function EmptyStateHeading({
  level,
  className,
  children,
}: {
  level: 2 | 3 | 4;
  className: string;
  children: ReactNode;
}) {
  switch (level) {
    case 2:
      return <h2 className={className}>{children}</h2>;
    case 3:
      return <h3 className={className}>{children}</h3>;
    case 4:
      return <h4 className={className}>{children}</h4>;
  }
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  guidance,
  action,
  headingLevel = 3,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/70 p-8 text-center sm:p-10',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 w-full max-w-2xl space-y-2 break-words">
        <EmptyStateHeading level={headingLevel} className="text-sm font-semibold text-foreground">
          {title}
        </EmptyStateHeading>
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
        {guidance ? <p className="text-xs leading-5 text-muted-foreground">{guidance}</p> : null}
      </div>
      {action &&
        (action.href ? (
          <Button asChild size="sm">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button onClick={action.onClick} size="sm">
            {action.label}
          </Button>
        ))}
    </div>
  );
}
