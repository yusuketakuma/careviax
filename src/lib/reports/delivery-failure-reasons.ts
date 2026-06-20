export const EMAIL_DELIVERY_FAILURE_REASON = 'メール送信に失敗しました';
const GENERIC_DELIVERY_FAILURE_REASON = '送付に失敗しました';
const EXTERNAL_DELIVERY_FAILURE_REASON = '外部送信に失敗しました';

const DISPLAYABLE_DELIVERY_FAILURE_REASONS = new Set([
  EMAIL_DELIVERY_FAILURE_REASON,
  GENERIC_DELIVERY_FAILURE_REASON,
  EXTERNAL_DELIVERY_FAILURE_REASON,
]);

export function resolveEmailDeliveryFailureReason(): string {
  return EMAIL_DELIVERY_FAILURE_REASON;
}

export function sanitizeDeliveryFailureReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const normalized = reason.trim();
  if (!normalized) return null;

  if (DISPLAYABLE_DELIVERY_FAILURE_REASONS.has(normalized)) return normalized;

  return GENERIC_DELIVERY_FAILURE_REASON;
}

export function displayDeliveryFailureReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return DISPLAYABLE_DELIVERY_FAILURE_REASONS.has(reason) ? reason : null;
}
