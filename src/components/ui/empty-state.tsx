import { type LucideIcon } from 'lucide-react';
import {
  StateActionButton,
  StateHeading,
  type StateAction,
  type StateHeadingLevel,
} from '@/components/ui/state-elements';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  guidance?: string;
  action?: StateAction;
  headingLevel?: Exclude<StateHeadingLevel, 1>;
  className?: string;
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
        <StateHeading level={headingLevel} className="text-sm font-semibold text-foreground">
          {title}
        </StateHeading>
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
        {guidance ? <p className="text-xs leading-5 text-muted-foreground">{guidance}</p> : null}
      </div>
      {action ? <StateActionButton action={action} defaultSize="sm" /> : null}
    </div>
  );
}
