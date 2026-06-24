import { NodeHttpHandler } from '@smithy/node-http-handler';
import { maybeUnrefTimeout } from '@/lib/utils/abort-timeout';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';

export const DEFAULT_AWS_CLIENT_REQUEST_TIMEOUT_MS = 5_000;
export const MAX_AWS_CLIENT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_AWS_CLIENT_CONNECTION_TIMEOUT_MS = 1_000;
export const MAX_AWS_CLIENT_CONNECTION_TIMEOUT_MS = 5_000;
export const DEFAULT_AWS_CLIENT_MAX_ATTEMPTS = 2;
export const MAX_AWS_CLIENT_MAX_ATTEMPTS = 5;

export const DEFAULT_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS = DEFAULT_AWS_CLIENT_REQUEST_TIMEOUT_MS;
export const MAX_PHOS_AWS_CLIENT_REQUEST_TIMEOUT_MS = MAX_AWS_CLIENT_REQUEST_TIMEOUT_MS;
export const DEFAULT_PHOS_AWS_CLIENT_CONNECTION_TIMEOUT_MS =
  DEFAULT_AWS_CLIENT_CONNECTION_TIMEOUT_MS;
export const MAX_PHOS_AWS_CLIENT_CONNECTION_TIMEOUT_MS = MAX_AWS_CLIENT_CONNECTION_TIMEOUT_MS;
export const DEFAULT_PHOS_AWS_CLIENT_MAX_ATTEMPTS = DEFAULT_AWS_CLIENT_MAX_ATTEMPTS;
export const MAX_PHOS_AWS_CLIENT_MAX_ATTEMPTS = MAX_AWS_CLIENT_MAX_ATTEMPTS;

type AwsSendOptions = {
  abortSignal?: AbortSignal;
  [key: string]: unknown;
};

type AwsSendClient = {
  send(command: unknown, options?: AwsSendOptions): Promise<unknown>;
};

function createTimeoutController(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('AWS_CLIENT_REQUEST_TIMEOUT'));
  }, timeoutMs);
  maybeUnrefTimeout(timeout);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export function awsClientRequestTimeoutMs(value = process.env.PHOS_AWS_CLIENT_TIMEOUT_MS) {
  return normalizePositiveTimeoutMs(value, {
    fallbackMs: DEFAULT_AWS_CLIENT_REQUEST_TIMEOUT_MS,
    maxMs: MAX_AWS_CLIENT_REQUEST_TIMEOUT_MS,
  });
}

export function awsClientConnectionTimeoutMs(
  value = process.env.PHOS_AWS_CLIENT_CONNECTION_TIMEOUT_MS,
) {
  return normalizePositiveTimeoutMs(value, {
    fallbackMs: DEFAULT_AWS_CLIENT_CONNECTION_TIMEOUT_MS,
    maxMs: MAX_AWS_CLIENT_CONNECTION_TIMEOUT_MS,
  });
}

export function phosAwsClientRequestTimeoutMs(value = process.env.PHOS_AWS_CLIENT_TIMEOUT_MS) {
  return awsClientRequestTimeoutMs(value);
}

export function phosAwsClientConnectionTimeoutMs(
  value = process.env.PHOS_AWS_CLIENT_CONNECTION_TIMEOUT_MS,
) {
  return awsClientConnectionTimeoutMs(value);
}

export function awsClientConfig() {
  const requestTimeout = awsClientRequestTimeoutMs();
  const connectionTimeout = Math.min(awsClientConnectionTimeoutMs(), requestTimeout);

  return {
    requestHandler: new NodeHttpHandler({
      connectionTimeout,
      requestTimeout,
    }),
    maxAttempts: normalizePositiveTimeoutMs(process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS, {
      fallbackMs: DEFAULT_AWS_CLIENT_MAX_ATTEMPTS,
      maxMs: MAX_AWS_CLIENT_MAX_ATTEMPTS,
    }),
  };
}

export function phosAwsClientConfig() {
  return awsClientConfig();
}

export function withAwsClientTimeout<TClient>(
  client: TClient,
  timeoutMs = awsClientRequestTimeoutMs(),
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

export function withPhosAwsClientTimeout<TClient>(
  client: TClient,
  timeoutMs = phosAwsClientRequestTimeoutMs(),
): TClient {
  return withAwsClientTimeout(client, timeoutMs);
}
