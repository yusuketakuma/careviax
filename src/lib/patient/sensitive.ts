import type { MemberRole } from '@prisma/client';

const SENSITIVE_DATA_ROLES = new Set<MemberRole>(['owner', 'admin', 'pharmacist']);

export function canViewSensitivePatientData(role: MemberRole) {
  return SENSITIVE_DATA_ROLES.has(role);
}

export function maskInsuranceNumber(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  if (normalized.length <= 4) return '*'.repeat(normalized.length);
  return `${'*'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
}

export function maskPhoneNumber(value: string | null | undefined) {
  if (!value) return null;
  let digitsRemaining = Math.max(0, value.replace(/\D/g, '').length - 4);
  return value
    .split('')
    .map((character) => {
      if (!/\d/.test(character)) return character;
      if (digitsRemaining > 0) {
        digitsRemaining -= 1;
        return '*';
      }
      return character;
    })
    .join('');
}

export function maskEmailAddress(value: string | null | undefined) {
  if (!value) return null;
  const [localPart, domain] = value.split('@');
  if (!domain || !localPart) return '***';
  const visible = localPart.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(2, localPart.length - 1))}@${domain}`;
}
