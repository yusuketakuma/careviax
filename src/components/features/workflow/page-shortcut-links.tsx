'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { useRovingFocus } from '@/components/features/keyboard/use-roving-focus';
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
    return <ShortcutLinkGroup links={links} ariaLabel="ページショートカット" />;
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
          <ShortcutLinkGroup links={group.links} ariaLabel={`${group.label}ショートカット`} />
        </div>
      ))}
    </div>
  );
}

function ShortcutLinkGroup({
  links,
  ariaLabel,
}: {
  links: readonly PageShortcutLink[];
  ariaLabel: string;
}) {
  const roving = useRovingFocus<HTMLAnchorElement>({
    itemCount: links.length,
    orientation: 'both',
  });

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className="flex flex-wrap justify-start gap-2 sm:justify-end"
    >
      {links.map((link, index) => (
        <Link
          key={`${link.href}:${link.label}`}
          href={link.href}
          {...roving.getItemProps(index)}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'h-auto min-h-[44px] sm:h-auto sm:min-h-[44px]',
          )}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
