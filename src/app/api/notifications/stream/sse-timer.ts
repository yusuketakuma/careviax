export function scheduleSseTimer(callback: () => void, delayMs: number) {
  const timeout = setTimeout(callback, delayMs);
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
  return timeout;
}
