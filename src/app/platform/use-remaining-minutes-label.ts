'use client';

import { useEffect, useState } from 'react';

function computeLabel(expiresAtIso: string): string {
  const remainingMs = new Date(expiresAtIso).getTime() - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '期限切れ';
  const minutes = Math.max(1, Math.round(remainingMs / 60000));
  return `残り${minutes}分`;
}

/**
 * Live "time remaining" label for a break-glass session, ticking every 15s.
 * Break-glass sessions are time-limited (default 30min) by design (§3 of
 * the platform-operator-console design doc); the UI must make the
 * countdown visible, not just the raw expiry timestamp.
 *
 * The label itself is a pure function of `expiresAtIso` (computed directly
 * during render, always fresh) — the effect only subscribes to an external
 * timer and forces a periodic re-render, rather than storing/derived-setting
 * the label in state (which would be a redundant-derived-state effect).
 */
export function useRemainingMinutesLabel(expiresAtIso: string): string {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      forceTick((tick) => tick + 1);
    }, 15_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return computeLabel(expiresAtIso);
}
