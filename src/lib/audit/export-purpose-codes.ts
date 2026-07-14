export const PHARMACY_INVOICE_PDF_EXPORT_PURPOSE = 'partner_cooperation_monthly_pdf' as const;

export type PharmacyInvoicePdfExportPurpose = typeof PHARMACY_INVOICE_PDF_EXPORT_PURPOSE;

const LEGACY_EXPORT_PURPOSE_MAX_LENGTH = 200;

export function normalizePharmacyInvoicePdfExportPurpose(
  value: string | null,
): PharmacyInvoicePdfExportPurpose | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > LEGACY_EXPORT_PURPOSE_MAX_LENGTH) return null;
  return PHARMACY_INVOICE_PDF_EXPORT_PURPOSE;
}

export function isPharmacyInvoicePdfExportPurpose(
  value: unknown,
): value is PharmacyInvoicePdfExportPurpose {
  return value === PHARMACY_INVOICE_PDF_EXPORT_PURPOSE;
}
