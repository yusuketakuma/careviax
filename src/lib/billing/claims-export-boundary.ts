export const CLAIMS_EXPORT_BOUNDARY = Object.freeze({
  responsibility: 'yrese_claim_accounting_domain',
  capability_status: 'blocked_external_contract',
  blocked_reason: 'official_contract_unapproved',
  handoff_available: false,
  redirect_url: null,
} as const);

export function claimsExportUnavailableDetails() {
  return { ...CLAIMS_EXPORT_BOUNDARY };
}
