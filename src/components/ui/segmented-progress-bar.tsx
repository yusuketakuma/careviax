'use client';

import { cn } from '@/lib/utils';

type SegmentedProgressBarProps = {
  value: number;
  max: number;
  className?: string;
  segmentClassName?: string;
  filledClassName?: string;
  emptyClassName?: string;
  markerValue?: number;
  markerClassName?: string;
};

const SEGMENT_COUNT = 100;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function SegmentedProgressBar({
  value,
  max,
  className,
  segmentClassName,
  filledClassName = 'bg-primary',
  emptyClassName = 'bg-transparent',
  markerValue,
  markerClassName = 'bg-state-confirm',
}: SegmentedProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const normalizedValue = clamp(value, 0, safeMax);
  const filledSegments = clamp(
    Math.round((normalizedValue / safeMax) * SEGMENT_COUNT),
    0,
    SEGMENT_COUNT,
  );
  const markerIndex =
    markerValue != null && max > 0
      ? clamp(
          Math.round((clamp(markerValue, 0, safeMax) / safeMax) * SEGMENT_COUNT) - 1,
          0,
          SEGMENT_COUNT - 1,
        )
      : null;

  return (
    <div
      className={cn(
        'grid grid-cols-[repeat(100,minmax(0,1fr))] overflow-hidden rounded-full bg-muted',
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(normalizedValue)}
      aria-valuemin={0}
      aria-valuemax={safeMax}
    >
      {Array.from({ length: SEGMENT_COUNT }, (_, index) => {
        const isFilled = index < filledSegments;
        const isMarker = markerIndex === index;

        return (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              'block h-full min-w-0',
              isFilled ? filledClassName : emptyClassName,
              isMarker && markerClassName,
              segmentClassName,
            )}
          />
        );
      })}
    </div>
  );
}
