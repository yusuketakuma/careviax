import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';

export const DEFAULT_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS = 5_000;
export const MAX_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_PHOS_AWS_CLIENT_MAX_ATTEMPTS = 2;
export const MAX_PHOS_AWS_CLIENT_MAX_ATTEMPTS = 5;

type AwsSendOptions = {
  abortSignal?: AbortSignal;
  [key: string]: unknown;
};

type AwsSendClient = {
  send(command: unknown, options?: AwsSendOptions): Promise<unknown>;
};

function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('PHOS_AWS_CLIENT_REQUEST_TIMEOUT'));
  }, timeoutMs);
  maybeUnrefTimeout(timeout);
  return controller.signal;
}

export function phosAwsClientRequestTimeoutMs(value = process.env.PHOS_AWS_CLIENT_TIMEOUT_MS) {
  return normalizePositiveTimeoutMs(value, {
    fallbackMs: DEFAULT_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS,
    maxMs: MAX_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS,
  });
}

export function phosAwsClientConfig() {
  return {
    maxAttempts: normalizePositiveTimeoutMs(process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS, {
      fallbackMs: DEFAULT_PHOS_AWS_CLIENT_MAX_ATTEMPTS,
      maxMs: MAX_PHOS_AWS_CLIENT_MAX_ATTEMPTS,
    }),
  };
}

export function withPhosAwsClientTimeout<TClient>(
  client: TClient,
  timeoutMs = phosAwsClientRequestTimeoutMs(),
): TClient {
  const sendClient = client as AwsSendClient;
  return {
    send(command: unknown, options: AwsSendOptions = {}) {
      return sendClient.send(command, {
        ...options,
        abortSignal: options.abortSignal ?? createTimeoutSignal(timeoutMs),
      });
    },
  } as TClient;
}
