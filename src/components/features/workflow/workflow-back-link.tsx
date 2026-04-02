import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

type WorkflowBackLinkProps = {
  href: string;
  label: string;
  className?: string;
};

export function WorkflowBackLink({
  href,
  label,
  className,
}: WorkflowBackLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted',
        className
      )}
    >
      <ChevronLeft className="size-3.5" aria-hidden="true" />
      {label}
    </Link>
  );
}
