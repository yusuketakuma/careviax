import { maybeUnrefTimeout } from '@/lib/utils/abort-timeout';

export { maybeUnrefTimeout } from '@/lib/utils/abort-timeout';

export type PhosRequestAbort = {
  signal: AbortSignal;
  didTimeout: () => boolean;
  clear: () => void;
};

export function createPhosRequestAbort(args: {
  timeoutMs: number;
  timeoutReason: Error;
  callerSignal?: AbortSignal;
}): PhosRequestAbort {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(args.callerSignal?.reason);

  if (args.callerSignal?.aborted) {
    abortFromCaller();
  } else {
    args.callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(args.timeoutReason);
  }, args.timeoutMs);
  maybeUnrefTimeout(timeout);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    clear: () => {
      clearTimeout(timeout);
      args.callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}
