'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SegmentedProgressBar } from '@/components/ui/segmented-progress-bar';
import { cn } from '@/lib/utils';

function isModifiedEvent(event: MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const routeKey = `${pathname}?${searchParams.toString()}`;

  const stopTimer = useCallback(() => {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startProgress = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setVisible(true);
    setProgress(12);
    stopTimer();
    intervalRef.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 90) return current;
        return current + Math.max(2, (90 - current) * 0.12);
      });
    }, 180);
  }, [stopTimer]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        isModifiedEvent(event) ||
        typeof window === 'undefined'
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (
        anchor.target === '_blank' ||
        anchor.hasAttribute('download') ||
        anchor.getAttribute('rel')?.includes('external')
      ) {
        return;
      }

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;

      const current = new URL(window.location.href);
      if (url.pathname === current.pathname && url.search === current.search) {
        return;
      }

      startProgress();
    };

    const handlePopState = () => {
      startProgress();
    };

    document.addEventListener('click', handleClick, true);
    window.addEventListener('popstate', handlePopState);
    return () => {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [startProgress]);

  useEffect(() => {
    if (!pendingRef.current) return;
    stopTimer();
    const completeFrame = window.setTimeout(() => {
      setProgress(100);
    }, 0);
    const timeout = window.setTimeout(() => {
      pendingRef.current = false;
      setVisible(false);
      setProgress(0);
    }, 180);
    return () => {
      window.clearTimeout(completeFrame);
      window.clearTimeout(timeout);
    };
  }, [routeKey, stopTimer]);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-1">
      <SegmentedProgressBar
        value={progress}
        max={100}
        className={cn(
          'h-full shadow-[0_0_12px_rgba(37,99,235,0.35)] transition-opacity duration-200 ease-out',
          visible ? 'opacity-100' : 'opacity-0'
        )}
        filledClassName="bg-primary"
        emptyClassName="bg-transparent"
      />
    </div>
  );
}
