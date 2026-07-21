import { normalizeConcurrencyLimit } from '@/lib/utils/concurrency';

const DEFAULT_BILLING_PREVIEW_BATCH_CONCURRENCY = 8;
const MAX_BILLING_PREVIEW_BATCH_CONCURRENCY = 16;

export function resolveBillingPreviewBatchConcurrency() {
  return normalizeConcurrencyLimit(process.env.BILLING_PREVIEW_BATCH_CONCURRENCY, {
    defaultValue: DEFAULT_BILLING_PREVIEW_BATCH_CONCURRENCY,
    max: MAX_BILLING_PREVIEW_BATCH_CONCURRENCY,
  });
}
