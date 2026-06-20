import { describe, expect, it } from 'vitest';

import {
  EMAIL_DELIVERY_FAILURE_REASON,
  displayDeliveryFailureReason,
  resolveEmailDeliveryFailureReason,
  sanitizeDeliveryFailureReason,
} from './delivery-failure-reasons';

describe('delivery failure reasons', () => {
  it('uses the safe canonical email failure reason', () => {
    const failureReason = resolveEmailDeliveryFailureReason();

    expect(failureReason).toBe(EMAIL_DELIVERY_FAILURE_REASON);
    expect(failureReason).not.toContain('SES unavailable');
  });

  it('sanitizes unknown persisted failure text to a generic delivery failure', () => {
    expect(sanitizeDeliveryFailureReason(' SMTP 550 recipient detail ')).toBe('送付に失敗しました');
    expect(sanitizeDeliveryFailureReason(` ${EMAIL_DELIVERY_FAILURE_REASON} `)).toBe(
      EMAIL_DELIVERY_FAILURE_REASON,
    );
    expect(sanitizeDeliveryFailureReason(null)).toBeNull();
    expect(sanitizeDeliveryFailureReason('   ')).toBeNull();
  });

  it('displays only known safe failure reasons in client UI', () => {
    expect(displayDeliveryFailureReason(EMAIL_DELIVERY_FAILURE_REASON)).toBe(
      EMAIL_DELIVERY_FAILURE_REASON,
    );
    expect(displayDeliveryFailureReason('SMTP 550 recipient detail')).toBeNull();
    expect(displayDeliveryFailureReason(null)).toBeNull();
  });
});
