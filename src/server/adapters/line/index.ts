import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import { createFetchTimeout } from '@/server/services/fetch-timeout';
import type { ProviderDeliveryResult } from '../delivery-result';

type LineAdapterConfig =
  | { provider: 'not_configured' }
  | {
      provider: 'line';
      channelAccessToken: string;
    };

const DEFAULT_LINE_DELIVERY_TIMEOUT_MS = 10_000;

export type LineProviderReadiness = {
  status: 'ready' | 'not_configured';
};

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
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (channelAccessToken) {
    return {
      provider: 'line',
      channelAccessToken,
    };
  }
  return { provider: 'not_configured' };
}

export function getLineProviderReadiness(): LineProviderReadiness {
  return { status: resolveLineConfig().provider === 'line' ? 'ready' : 'not_configured' };
}

export class LineNotificationAdapter {
  constructor(private readonly config: LineAdapterConfig = resolveLineConfig()) {}

  async sendMessage(userId: string, message: string): Promise<ProviderDeliveryResult> {
    if (userId.trim().length === 0) {
      throw new LineNotificationAdapterError('LINE delivery target is required');
    }
    if (message.trim().length === 0) {
      throw new LineNotificationAdapterError('LINE delivery message is required');
    }

    if (this.config.provider === 'not_configured') {
      return { status: 'not_configured', provider: null, providerMessageId: null };
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
    } catch {
      return { status: 'unknown', provider: 'line', providerMessageId: null };
    } finally {
      abort.clear();
    }

    if (!response.ok) {
      return { status: 'failed', provider: 'line', providerMessageId: null };
    }
    const providerMessageId = response.headers.get('x-line-request-id')?.trim();
    return providerMessageId
      ? { status: 'accepted', provider: 'line', providerMessageId }
      : { status: 'unknown', provider: 'line', providerMessageId: null };
  }
}
