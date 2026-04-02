import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PageShortcutLink = {
  href: string;
  label: string;
};

type PageShortcutLinksProps = {
  links: readonly PageShortcutLink[];
};

export function PageShortcutLinks({ links }: PageShortcutLinksProps) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {links.map((link) => (
        <Link
          key={`${link.href}:${link.label}`}
          href={link.href}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8')}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
