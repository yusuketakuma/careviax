import { retryDueWebhookDeliveries } from '@/server/services/outbound-webhook';
import { runJob } from './runner';

type WebhookRetryJobContext = {
  orgId?: string;
};

export function retryWebhookDeliveries(context: WebhookRetryJobContext = {}) {
  return runJob(
    'webhook_delivery_retry',
    () => retryDueWebhookDeliveries({ orgId: context.orgId }),
    context.orgId,
  );
}
