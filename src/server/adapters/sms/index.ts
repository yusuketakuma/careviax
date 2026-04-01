type SmsAdapterConfig =
  | {
      provider: 'stub';
    }
  | {
      provider: 'twilio';
      accountSid: string;
      authToken: string;
      fromNumber: string;
    };

function resolveSmsConfig(): SmsAdapterConfig {
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  ) {
    return {
      provider: 'twilio',
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      fromNumber: process.env.TWILIO_FROM_NUMBER,
    };
  }
  return { provider: 'stub' };
}

export class SmsNotificationAdapter {
  constructor(private readonly config: SmsAdapterConfig = resolveSmsConfig()) {}

  async sendSms(phoneNumber: string, message: string): Promise<void> {
    if (this.config.provider === 'stub') {
      console.warn('[SMS] provider is not configured; skipping delivery');
      return;
    }

    if (this.config.provider === 'twilio') {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${this.config.accountSid}:${this.config.authToken}`
            ).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: phoneNumber,
            From: this.config.fromNumber,
            Body: message,
          }).toString(),
        }
      );

      if (!response.ok) {
        throw new Error(`SMS delivery failed: ${response.status}`);
      }
      return;
    }

  }
}
