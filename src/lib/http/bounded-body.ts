const BYTES_PER_MIB = 1024 * 1024;

export const DEFAULT_HTTP_BODY_MAX_BYTES = BYTES_PER_MIB;
export const HARD_HTTP_BODY_MAX_BYTES = 5 * BYTES_PER_MIB;
export const DEFAULT_HTTP_BODY_DEADLINE_MS = 10_000;
export const HARD_HTTP_BODY_DEADLINE_MS = 30_000;

export type BoundedBodyReadOptions = {
  maxBytes?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
};

export type BoundedBodyReadPolicy = {
  maxBytes: number;
  deadlineMs: number;
};

export type BoundedBodyReadFailureReason = 'too_large' | 'timeout' | 'aborted' | 'unreadable';

export type BoundedBodyReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: BoundedBodyReadFailureReason };

export type BoundedBodySource = Pick<Request, 'body' | 'bodyUsed' | 'headers'> & {
  signal?: AbortSignal;
};

type StopReason = Extract<BoundedBodyReadFailureReason, 'timeout' | 'aborted'>;

function normalizeBoundedPositiveInteger(
  value: number | undefined,
  defaultValue: number,
  hardLimit: number,
) {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value <= 0) return 1;
  return Math.min(value, hardLimit);
}

function contentLengthExceedsLimit(headers: Headers, maxBytes: number) {
  const rawContentLength = headers.get('content-length');
  if (!rawContentLength || !/^\d+$/.test(rawContentLength)) return false;

  try {
    return BigInt(rawContentLength) > BigInt(maxBytes);
  } catch {
    return true;
  }
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    reader.releaseLock();
  } catch {
    // A pending read keeps the lock until cancellation settles.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    const cancellation = reader.cancel();
    void cancellation
      .catch(() => undefined)
      .finally(() => {
        releaseReader(reader);
      });
  } catch {
    // Cancellation is best-effort and must not replace the primary failure.
  }
  releaseReader(reader);
}

function cancelStream(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return;
  try {
    void stream.cancel().catch(() => undefined);
  } catch {
    // Content-Length rejection remains authoritative when cancellation fails.
  }
}

function createStopMonitor(signals: readonly AbortSignal[], deadlineMs: number) {
  let stop: (reason: StopReason) => void = () => undefined;
  let settled = false;
  const promise = new Promise<StopReason>((resolve) => {
    stop = (reason) => {
      if (settled) return;
      settled = true;
      resolve(reason);
    };
  });
  const onAbort = () => stop('aborted');
  const timeout = setTimeout(() => stop('timeout'), deadlineMs);

  for (const signal of signals) {
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  }

  return {
    promise,
    cleanup() {
      clearTimeout(timeout);
      for (const signal of signals) {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

function concatenateChunks(chunks: Uint8Array[], totalBytes: number) {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function resolveBoundedBodyReadPolicy(
  options: BoundedBodyReadOptions = {},
): BoundedBodyReadPolicy {
  return {
    maxBytes: normalizeBoundedPositiveInteger(
      options.maxBytes,
      DEFAULT_HTTP_BODY_MAX_BYTES,
      HARD_HTTP_BODY_MAX_BYTES,
    ),
    deadlineMs: normalizeBoundedPositiveInteger(
      options.deadlineMs,
      DEFAULT_HTTP_BODY_DEADLINE_MS,
      HARD_HTTP_BODY_DEADLINE_MS,
    ),
  };
}

export async function readBoundedBody(
  source: BoundedBodySource,
  options: BoundedBodyReadOptions = {},
): Promise<BoundedBodyReadResult> {
  const { maxBytes, deadlineMs } = resolveBoundedBodyReadPolicy(options);
  const signals = [source.signal, options.signal].filter(
    (signal, index, all): signal is AbortSignal =>
      signal !== undefined && all.indexOf(signal) === index,
  );

  if (signals.some((signal) => signal.aborted)) {
    cancelStream(source.body);
    return { ok: false, reason: 'aborted' };
  }

  if (contentLengthExceedsLimit(source.headers, maxBytes)) {
    cancelStream(source.body);
    return { ok: false, reason: 'too_large' };
  }

  if (!source.body) return { ok: true, bytes: new Uint8Array() };
  if (source.bodyUsed || source.body.locked) return { ok: false, reason: 'unreadable' };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = source.body.getReader();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  const stopMonitor = createStopMonitor(signals, deadlineMs);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let readerCancelled = false;

  try {
    while (true) {
      const readOutcome = await Promise.race([
        reader.read().then(
          (result) => ({ type: 'read' as const, result }),
          () => ({ type: 'read_error' as const }),
        ),
        stopMonitor.promise.then((reason) => ({ type: 'stop' as const, reason })),
      ]);

      if (readOutcome.type === 'stop') {
        readerCancelled = true;
        cancelReader(reader);
        return { ok: false, reason: readOutcome.reason };
      }

      if (readOutcome.type === 'read_error') {
        readerCancelled = true;
        cancelReader(reader);
        return {
          ok: false,
          reason: signals.some((signal) => signal.aborted) ? 'aborted' : 'unreadable',
        };
      }

      const { done, value } = readOutcome.result;
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        readerCancelled = true;
        cancelReader(reader);
        return { ok: false, reason: 'unreadable' };
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        readerCancelled = true;
        cancelReader(reader);
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }

    return { ok: true, bytes: concatenateChunks(chunks, totalBytes) };
  } finally {
    stopMonitor.cleanup();
    if (!readerCancelled) releaseReader(reader);
  }
}
