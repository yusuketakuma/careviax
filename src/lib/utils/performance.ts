/**
 * Performance monitoring utilities — placeholder
 * Target: P95 < 500ms for all API endpoints
 */
export function measureApiLatency(routeName: string, startTime: number): void {
  const duration = Date.now() - startTime;
  if (duration > 500) {
    console.warn(`[PERF] ${routeName} took ${duration}ms (exceeds 500ms target)`);
  }
}

export function withPerformanceLogging<T>(
  routeName: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  return fn().finally(() => measureApiLatency(routeName, start));
}
