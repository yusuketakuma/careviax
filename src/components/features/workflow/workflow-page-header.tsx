import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type WorkflowPageHeaderAction = {
  href: string;
  label: string;
  icon?: ReactNode;
};

type WorkflowPageHeaderProps = {
  title: string;
  description: string;
  action?: WorkflowPageHeaderAction;
  children?: ReactNode;
  className?: string;
};

export function WorkflowPageHeader({
  title,
  description,
  action,
  children,
  className,
}: WorkflowPageHeaderProps) {
  return (
    <div className={cn('mb-6 space-y-4', className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>

        {action ? (
          <Link
            href={action.href}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action.icon}
            {action.label}
          </Link>
        ) : null}
      </div>

      {children ? <div className="flex items-center justify-end">{children}</div> : null}
    </div>
  );
}
