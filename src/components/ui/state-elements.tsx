import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export type StateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
  size?: 'default' | 'sm' | 'lg';
};

export type StateHeadingLevel = 1 | 2 | 3 | 4;

export function StateActionButton({
  action,
  defaultSize = 'default',
}: {
  action: StateAction;
  defaultSize?: StateAction['size'];
}) {
  const variant = action.variant ?? 'default';
  const size = action.size ?? defaultSize;

  if (action.href) {
    return (
      <Button asChild type="button" variant={variant} size={size}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

export function StateHeading({
  level,
  className,
  children,
}: {
  level: StateHeadingLevel;
  className: string;
  children: ReactNode;
}) {
  switch (level) {
    case 1:
      return <h1 className={className}>{children}</h1>;
    case 2:
      return <h2 className={className}>{children}</h2>;
    case 3:
      return <h3 className={className}>{children}</h3>;
    case 4:
      return <h4 className={className}>{children}</h4>;
  }
}
