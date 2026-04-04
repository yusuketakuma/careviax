export type BillingPayerBasis = 'medical' | 'care' | 'self_pay';

/**
 * Determine payer basis for home-visit billing.
 *
 * Rules:
 * - emergency visit => medical when either insurance exists, otherwise self_pay
 * - regular visit => care preferred over medical
 * - no insurance => self_pay
 */
export function resolveBillingPayerBasis(args: {
  medicalInsuranceNumber?: string | null;
  careInsuranceNumber?: string | null;
  visitType?: string | null;
}): BillingPayerBasis {
  if (args.visitType === 'emergency') {
    return args.medicalInsuranceNumber || args.careInsuranceNumber ? 'medical' : 'self_pay';
  }
  if (args.careInsuranceNumber) return 'care';
  if (args.medicalInsuranceNumber) return 'medical';
  return 'self_pay';
}
