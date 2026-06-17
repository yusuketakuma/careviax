import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { Phase } from './dispensing-workbench.types';

const PHASES: Array<{ id: Phase; label: string; href: string }> = [
  { id: 'dispense', label: '調剤', href: '/dispense' },
  { id: 'audit', label: '調剤監査', href: '/audit' },
  { id: 'setp', label: 'セット', href: '/set' },
  { id: 'seta', label: 'セット監査', href: '/set-audit' },
];

type WorkbenchLoadingNavProps = {
  phase: Phase;
};

export function WorkbenchLoadingNav({ phase }: WorkbenchLoadingNavProps) {
  return (
    <nav
      aria-label="工程タブ"
      className="flex flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-card p-1"
    >
      {PHASES.map((item) => {
        const active = item.id === phase;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-bold sm:min-h-9',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
