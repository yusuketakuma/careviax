'use client';

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      return;
    }

    const handle = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => window.clearTimeout(handle);
  }, [delayMs, value]);

  // delayMs<=0 disables debouncing: derive the live value during render rather
  // than synchronously calling setState inside the effect (which triggers the
  // cascading renders flagged by react-hooks/set-state-in-effect). For
  // delayMs>0 the timeout-updated state drives the returned value.
  return delayMs <= 0 ? value : debouncedValue;
}
