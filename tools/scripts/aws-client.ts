import { NodeHttpHandler } from '@smithy/node-http-handler';

export const DEFAULT_SCRIPT_AWS_CLIENT_REQUEST_TIMEOUT_MS = 5_000;
export const MAX_SCRIPT_AWS_CLIENT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_SCRIPT_AWS_CLIENT_CONNECTION_TIMEOUT_MS = 1_000;
export const MAX_SCRIPT_AWS_CLIENT_CONNECTION_TIMEOUT_MS = 5_000;
export const DEFAULT_SCRIPT_AWS_CLIENT_MAX_ATTEMPTS = 2;
export const MAX_SCRIPT_AWS_CLIENT_MAX_ATTEMPTS = 5;

type AwsSendOptions = {
  abortSignal?: AbortSignal;
  [key: string]: unknown;
};

type AwsSendClient = {
  send(command: unknown, options?: AwsSendOptions): Promise<unknown>;
};

function normalizePositiveInteger(
  value: string | undefined,
  options: {
    fallback: number;
    max: number;
  },
) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return options.fallback;
  return Math.min(parsed, options.max);
}

function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}

function createTimeoutController(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('SCRIPT_AWS_CLIENT_REQUEST_TIMEOUT'));
  }, timeoutMs);
  maybeUnrefTimeout(timeout);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export function scriptAwsClientConfig() {
  const requestTimeout = scriptAwsClientRequestTimeoutMs();
  const connectionTimeout = Math.min(scriptAwsClientConnectionTimeoutMs(), requestTimeout);

  return {
    requestHandler: new NodeHttpHandler({
      connectionTimeout,
      requestTimeout,
    }),
    maxAttempts: normalizePositiveInteger(process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS, {
      fallback: DEFAULT_SCRIPT_AWS_CLIENT_MAX_ATTEMPTS,
      max: MAX_SCRIPT_AWS_CLIENT_MAX_ATTEMPTS,
    }),
  };
}

export function scriptAwsClientRequestTimeoutMs(value = process.env.PHOS_AWS_CLIENT_TIMEOUT_MS) {
  return normalizePositiveInteger(value, {
    fallback: DEFAULT_SCRIPT_AWS_CLIENT_REQUEST_TIMEOUT_MS,
    max: MAX_SCRIPT_AWS_CLIENT_REQUEST_TIMEOUT_MS,
  });
}

export function scriptAwsClientConnectionTimeoutMs(
  value = process.env.PHOS_AWS_CLIENT_CONNECTION_TIMEOUT_MS,
) {
  return normalizePositiveInteger(value, {
    fallback: DEFAULT_SCRIPT_AWS_CLIENT_CONNECTION_TIMEOUT_MS,
    max: MAX_SCRIPT_AWS_CLIENT_CONNECTION_TIMEOUT_MS,
  });
}

export function withScriptAwsClientTimeout<TClient>(
  client: TClient,
  timeoutMs = scriptAwsClientRequestTimeoutMs(),
): TClient {
  const sendClient = client as AwsSendClient;
  return {
    async send(command: unknown, options: AwsSendOptions = {}) {
      if (options.abortSignal) {
        return sendClient.send(command, options);
      }

      const timeout = createTimeoutController(timeoutMs);
      try {
        return await sendClient.send(command, {
          ...options,
          abortSignal: timeout.signal,
        });
      } finally {
        timeout.clear();
      }
    },
  } as TClient;
}
