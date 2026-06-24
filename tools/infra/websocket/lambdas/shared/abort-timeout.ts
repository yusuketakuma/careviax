// Boundary-local copy of src/lib/utils/abort-timeout; keep the guard behavior in sync.
export function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}
