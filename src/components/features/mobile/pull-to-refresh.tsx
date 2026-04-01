'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  /** Pull distance (px) required to trigger refresh. Default: 60 */
  threshold?: number;
  /** Whether pull-to-refresh is enabled. Default: true */
  enabled?: boolean;
}

type PullState = 'idle' | 'pulling' | 'refreshing';

const PULL_HEIGHT_CLASSES = [
  'h-0',
  'h-2',
  'h-4',
  'h-6',
  'h-8',
  'h-10',
  'h-12',
  'h-14',
  'h-16',
  'h-20',
  'h-24',
  'h-28',
  'h-32',
] as const;

const PULL_OPACITY_CLASSES = [
  'opacity-0',
  'opacity-25',
  'opacity-50',
  'opacity-75',
  'opacity-100',
] as const;

const PULL_ROTATION_CLASSES = [
  'rotate-0',
  'rotate-45',
  'rotate-90',
  'rotate-[135deg]',
  'rotate-180',
  'rotate-[225deg]',
  'rotate-[270deg]',
  'rotate-[315deg]',
  'rotate-[360deg]',
] as const;

export function PullToRefresh({
  onRefresh,
  children,
  threshold = 60,
  enabled = true,
}: PullToRefreshProps) {
  const [pullState, setPullState] = useState<PullState>('idle');
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || pullState === 'refreshing') return;
      // Only activate when scrolled to top
      const container = containerRef.current;
      if (container && container.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
    },
    [enabled, pullState]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || pullState === 'refreshing' || startY.current === 0) return;
      const currentY = e.touches[0].clientY;
      const delta = currentY - startY.current;
      if (delta > 0) {
        // Apply diminishing pull effect
        const distance = Math.min(delta * 0.5, threshold * 2);
        setPullDistance(distance);
        setPullState('pulling');
      }
    },
    [enabled, pullState, threshold]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!enabled || pullState !== 'pulling') {
      startY.current = 0;
      return;
    }

    if (pullDistance >= threshold) {
      setPullState('refreshing');
      setPullDistance(threshold);
      try {
        await onRefresh();
      } finally {
        setPullState('idle');
        setPullDistance(0);
      }
    } else {
      setPullState('idle');
      setPullDistance(0);
    }
    startY.current = 0;
  }, [enabled, onRefresh, pullDistance, pullState, threshold]);

  const indicatorOpacity = pullState === 'idle' ? 0 : Math.min(pullDistance / threshold, 1);
  const isThresholdReached = pullDistance >= threshold;
  const heightIndex =
    pullState === 'idle'
      ? 0
      : Math.min(
          PULL_HEIGHT_CLASSES.length - 1,
          Math.max(1, Math.round((pullDistance / Math.max(threshold * 2, 1)) * (PULL_HEIGHT_CLASSES.length - 1)))
        );
  const opacityIndex = Math.min(
    PULL_OPACITY_CLASSES.length - 1,
    Math.round(indicatorOpacity * (PULL_OPACITY_CLASSES.length - 1))
  );
  const rotationIndex = Math.min(
    PULL_ROTATION_CLASSES.length - 1,
    Math.round(indicatorOpacity * (PULL_ROTATION_CLASSES.length - 1))
  );

  return (
    <div
      ref={containerRef}
      className="relative overflow-auto"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className={[
          'flex items-center justify-center overflow-hidden transition-[height] duration-200',
          PULL_HEIGHT_CLASSES[heightIndex],
        ].join(' ')}
        aria-hidden="true"
      >
        <div
          className={[
            'flex items-center gap-2 text-sm text-muted-foreground transition-opacity duration-200',
            PULL_OPACITY_CLASSES[opacityIndex],
          ].join(' ')}
        >
          <RefreshCw
            className={[
              'size-4 transition-transform',
              pullState === 'pulling' ? PULL_ROTATION_CLASSES[rotationIndex] : '',
              pullState === 'refreshing' ? 'animate-spin' : '',
              isThresholdReached && pullState === 'pulling' ? 'text-primary' : '',
            ].join(' ')}
          />
          <span>
            {pullState === 'refreshing'
              ? '更新中...'
              : isThresholdReached
                ? '離して更新'
                : '引き下げて更新'}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}
