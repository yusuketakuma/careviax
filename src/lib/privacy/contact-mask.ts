export function looksLikePhoneNumber(value: string | null | undefined) {
  if (!value) return false;
  const normalized = value.replace(/[^\d+]/g, '');
  return /^(\+?\d{10,15})$/.test(normalized);
}

export function maskPhoneContact(
  value: string,
  options: { leadingDigits?: number; trailingDigits?: number } = {},
) {
  const digitsOnly = value.replace(/[^\d]/g, '');
  const trailingDigits = options.trailingDigits ?? 4;
  const leadingDigits = options.leadingDigits ?? 0;
  if (digitsOnly.length < trailingDigits) return value ? '***' : '';
  const prefix =
    leadingDigits > 0 && digitsOnly.length > leadingDigits + trailingDigits
      ? digitsOnly.slice(0, leadingDigits)
      : '***';
  return `${prefix}****${digitsOnly.slice(-trailingDigits)}`;
}

export function maskEmailContact(value: string) {
  const [localPart, domain] = value.split('@');
  if (!localPart || !domain) return '***';
  return `${localPart.slice(0, 1)}***@${domain}`;
}

export function maskContactValueForAudit(
  value: string | null,
  options: { phoneLeadingDigits?: number } = {},
) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.includes('@')) return maskEmailContact(trimmed);
  if (looksLikePhoneNumber(trimmed)) {
    return maskPhoneContact(trimmed, { leadingDigits: options.phoneLeadingDigits ?? 0 });
  }
  return trimmed.length <= 4 ? '****' : `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
}
