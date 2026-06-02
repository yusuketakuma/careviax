type LineAdapterConfig =
  | { provider: 'stub' }
  | {
      provider: 'line';
      channelAccessToken: string;
    };

export class LineNotificationAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineNotificationAdapterError';
  }
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

    const response = await fetch('https://api.line.me/v2/bot/message/push', {
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
    });

    if (!response.ok) {
      throw new Error(`LINE delivery failed: ${response.status}`);
    }
  }
}
