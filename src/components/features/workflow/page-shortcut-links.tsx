'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PageShortcutLink = {
  href: string;
  label: string;
  group?: string;
};

type PageShortcutLinksProps = {
  links: readonly PageShortcutLink[];
};

export function PageShortcutLinks({ links }: PageShortcutLinksProps) {
  const grouped = links.some((link) => link.group);

  if (!grouped) {
    return (
      <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
        {links.map((link) => (
          <Link
            key={`${link.href}:${link.label}`}
            href={link.href}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9 sm:h-8')}
          >
            {link.label}
          </Link>
        ))}
      </div>
    );
  }

  const groups = links.reduce<Array<{ label: string; links: PageShortcutLink[] }>>((acc, link) => {
    const label = link.group ?? 'その他';
    const current = acc.find((group) => group.label === label);

    if (current) {
      current.links.push(link);
      return acc;
    }

    acc.push({ label, links: [link] });
    return acc;
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
            {group.links.map((link) => (
              <Link
                key={`${group.label}:${link.href}:${link.label}`}
                href={link.href}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9 sm:h-8')}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
