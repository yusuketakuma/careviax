import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import { createFetchTimeout } from '@/server/services/fetch-timeout';

type LineAdapterConfig =
  | { provider: 'stub' }
  | {
      provider: 'line';
      channelAccessToken: string;
    };

const DEFAULT_LINE_DELIVERY_TIMEOUT_MS = 10_000;

export class LineNotificationAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineNotificationAdapterError';
  }
}

function resolveLineDeliveryTimeoutMs() {
  return normalizePositiveTimeoutMs(process.env.LINE_DELIVERY_TIMEOUT_MS, {
    fallbackMs: DEFAULT_LINE_DELIVERY_TIMEOUT_MS,
  });
}

function resolveLineConfig(): LineAdapterConfig {
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    return {
      provider: 'line',
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    };
  }
  return { provider: 'stub' };
}

export class LineNotificationAdapter {
  constructor(private readonly config: LineAdapterConfig = resolveLineConfig()) {}

  async sendMessage(userId: string, message: string): Promise<void> {
    if (userId.trim().length === 0) {
      throw new LineNotificationAdapterError('LINE delivery target is required');
    }
    if (message.trim().length === 0) {
      throw new LineNotificationAdapterError('LINE delivery message is required');
    }

    if (this.config.provider === 'stub') {
      console.warn('[LINE] provider is not configured; skipping delivery');
      return;
    }

    const abort = createFetchTimeout(resolveLineDeliveryTimeoutMs());
    let response: Response;
    try {
      response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.channelAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: userId,
          messages: [
            {
              type: 'text',
              text: message,
            },
          ],
        }),
        signal: abort.signal,
      });
    } finally {
      abort.clear();
    }

    if (!response.ok) {
      throw new Error(`LINE delivery failed: ${response.status}`);
    }
  }
}
