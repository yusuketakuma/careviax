'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type HelpPopoverProps = {
  title: string;
  description: ReactNode;
  buttonLabel?: string;
  className?: string;
  panelClassName?: string;
};

export function HelpPopover({
  title,
  description,
  buttonLabel,
  className,
  panelClassName,
}: HelpPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | undefined>();
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const updatePanelPosition = () => {
      const button = buttonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 16;
      const gap = 8;
      const width = Math.min(288, Math.max(220, viewportWidth - margin * 2));
      const left = Math.min(
        Math.max(rect.right - width, margin),
        Math.max(margin, viewportWidth - width - margin),
      );
      const belowTop = rect.bottom + gap;
      const estimatedHeight = 176;
      const top =
        belowTop + estimatedHeight > viewportHeight
          ? Math.max(margin, rect.top - estimatedHeight - gap)
          : belowTop;

      setPanelStyle({
        left,
        top,
        width,
      });
    };

    updatePanelPosition();
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);

    return () => {
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
    };
  }, [isOpen]);

  return (
    <span className={cn('inline-flex', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        aria-label={buttonLabel ?? `${title}の説明`}
        className="inline-flex size-11 items-center justify-center rounded-full border border-border/70 bg-background text-sm font-semibold text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.06] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-8"
        onBlur={() => setIsOpen(false)}
        onClick={() => setIsOpen((current) => !current)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        ?
      </button>
      {isOpen ? (
        <span
          id={tooltipId}
          role="tooltip"
          style={panelStyle}
          className={cn(
            'fixed z-[100] rounded-xl border border-border/70 bg-popover px-3 py-3 text-left text-sm leading-6 text-popover-foreground shadow-xl',
            panelClassName,
          )}
        >
          <span className="block font-semibold text-foreground">{title}</span>
          <span className="mt-1 block text-muted-foreground">{description}</span>
          <span className="mt-2 block text-[11px] text-muted-foreground sm:hidden">
            もう一度 ? をタップして閉じます。
          </span>
        </span>
      ) : null}
    </span>
  );
}
