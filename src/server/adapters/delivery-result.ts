export type DeliveryProvider = 'twilio' | 'line' | 'web_push';

export type ProviderDeliveryResult =
  | {
      status: 'accepted';
      provider: DeliveryProvider;
      providerMessageId: string | null;
    }
  | {
      status: 'not_configured' | 'failed' | 'unknown';
      provider: DeliveryProvider | null;
      providerMessageId: null;
    };

export function isProviderDeliveryResult(value: unknown): value is ProviderDeliveryResult {
  if (!value || typeof value !== 'object') return false;
  const status = Reflect.get(value, 'status');
  return (
    status === 'accepted' ||
    status === 'not_configured' ||
    status === 'failed' ||
    status === 'unknown'
  );
}
