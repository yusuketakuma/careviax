'use client';

import { memo, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import {
  COCKPIT_FRESHNESS_WINDOW_MS,
  formatCockpitGeneratedAtMeta,
  formatDeadlineCountdown,
  formatAgeLabel,
  formatTimeOfDay,
  TIMELINE_END_MINUTES,
  TIMELINE_START_MINUTES,
  timelinePercent,
} from './dashboard-cockpit.helpers';

export function useDashboardClock(intervalMs = COCKPIT_FRESHNESS_WINDOW_MS) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

export const DashboardHeaderClock = memo(function DashboardHeaderClock({
  scopeLabel,
}: {
  scopeLabel: string;
}) {
  const now = useDashboardClock();
  const dateLabel = `${format(now, 'M/d(EEE) HH:mm', { locale: ja })} — ${scopeLabel}`;

  return (
    <p className="text-sm text-muted-foreground" suppressHydrationWarning>
      {dateLabel}
    </p>
  );
});

export const DashboardGeneratedAtMeta = memo(function DashboardGeneratedAtMeta({
  generatedAt,
}: {
  generatedAt: string;
}) {
  const now = useDashboardClock();
  return <>{formatCockpitGeneratedAtMeta(generatedAt, now)}</>;
});

export const DeadlineCountdownLabel = memo(function DeadlineCountdownLabel({
  dueAt,
}: {
  dueAt: string;
}) {
  const now = useDashboardClock();
  const countdown = formatDeadlineCountdown(dueAt, now);

  return (
    <p className="text-sm font-bold text-destructive">
      期限 {formatTimeOfDay(dueAt)} — {countdown.label}
    </p>
  );
});

export const WaitingSinceLabel = memo(function WaitingSinceLabel({
  waitingSince,
}: {
  waitingSince: string;
}) {
  const now = useDashboardClock();
  const waitingMinutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(waitingSince).getTime()) / 60_000),
  );

  return (
    <p className="text-sm font-semibold text-state-confirm">
      {formatAgeLabel(waitingMinutes)}前から対応待ちです
    </p>
  );
});

export const DashboardNowMarker = memo(function DashboardNowMarker() {
  const now = useDashboardClock();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNowMarker = nowMinutes >= TIMELINE_START_MINUTES && nowMinutes <= TIMELINE_END_MINUTES;

  if (!showNowMarker) return null;

  return (
    <>
      <span
        aria-hidden="true"
        className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-tag-info"
        style={{ left: `${timelinePercent(nowMinutes)}%` }}
      />
      <p
        className={cn('mt-1 text-xs font-semibold text-tag-info')}
        style={{ paddingLeft: `${Math.min(timelinePercent(nowMinutes), 88)}%` }}
      >
        いま {formatTimeOfDay(now.toISOString())}
      </p>
    </>
  );
});
