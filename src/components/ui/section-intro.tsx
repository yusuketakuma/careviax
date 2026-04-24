'use client';

import { HelpPopover } from './help-popover';

export function SectionIntro({
  id,
  title,
  description,
}: {
  id?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <h2 id={id} className="text-base font-semibold text-foreground">
          {title}
        </h2>
        <HelpPopover title={title} description={description} />
      </div>
    </div>
  );
}
