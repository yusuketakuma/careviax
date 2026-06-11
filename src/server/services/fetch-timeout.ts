export function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}

export function createFetchTimeout(timeoutMs: number, reason?: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(reason), timeoutMs);
  maybeUnrefTimeout(timeout);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}
