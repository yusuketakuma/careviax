import Link from 'next/link';
import { type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HelpPopover } from '@/components/ui/help-popover';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border p-12 text-center',
        className,
      )}
      role="status"
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <HelpPopover title={title} description={description} /> : null}
      </div>
      {action &&
        (action.href ? (
          <Link
            href={action.href}
            className={cn(
              'inline-flex min-h-[44px] items-center justify-center rounded-[min(var(--radius-md),12px)] bg-primary px-3 text-[0.8rem] font-medium text-primary-foreground transition-colors hover:bg-primary/80 sm:h-7 sm:min-h-0 sm:px-2.5',
            )}
          >
            {action.label}
          </Link>
        ) : (
          <Button onClick={action.onClick} size="sm">
            {action.label}
          </Button>
        ))}
    </div>
  );
}
