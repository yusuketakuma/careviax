import type { MemberRole } from '@prisma/client';

export type PatientPrivacyFlags = {
  sensitiveFieldsMasked: boolean;
  addressFieldsMasked: boolean;
  canViewDetail: boolean;
};

export function getPatientPrivacyFlags(role: MemberRole | string): PatientPrivacyFlags {
  switch (role) {
    case 'external_viewer':
      return {
        sensitiveFieldsMasked: true,
        addressFieldsMasked: true,
        canViewDetail: false,
      };
    case 'clerk':
      return {
        sensitiveFieldsMasked: true,
        addressFieldsMasked: false,
        canViewDetail: true,
      };
    default:
      return {
        sensitiveFieldsMasked: false,
        addressFieldsMasked: false,
        canViewDetail: true,
      };
  }
}

export function maskPhoneNumber(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-****-${digits.slice(-4)}`;
}

export function maskInsuranceNumber(value: string | null) {
  if (!value) return null;
  if (value.length <= 3) return '***';
  return `***-${value.slice(-3)}`;
}

export function maskEmailAddress(value: string | null) {
  if (!value) return null;
  const [localPart, domain] = value.split('@');
  if (!domain) return '***';
  return `${localPart.slice(0, 1) || '*'}***@${domain}`;
}

export function maskContactValue(value: string | null) {
  if (!value) return null;
  return value.includes('@') ? maskEmailAddress(value) : maskPhoneNumber(value);
}

export function maskAddressDetail(value: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return `${normalized.slice(0, Math.min(6, normalized.length))}***`;
}
