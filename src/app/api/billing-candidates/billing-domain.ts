export const BILLING_DOMAIN_ERROR_MESSAGE =
  'billing_domain は home_care または pca_rental を指定してください';

export const BILLING_DOMAINS = ['home_care', 'pca_rental'] as const;

export type BillingDomain = (typeof BILLING_DOMAINS)[number];

export function isBillingDomain(value: unknown): value is BillingDomain {
  return typeof value === 'string' && (BILLING_DOMAINS as readonly string[]).includes(value);
}

export function parseOptionalBillingDomain(value: unknown): BillingDomain | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  return isBillingDomain(value) ? value : null;
}

export function parseBillingDomainOrDefault(
  value: unknown,
  defaultValue: BillingDomain = 'home_care',
): BillingDomain | null {
  const parsed = parseOptionalBillingDomain(value);
  if (parsed === null) return null;
  return parsed ?? defaultValue;
}
