import type { MemberRole } from '@prisma/client';
import { UserRole, type UserRole as PhosUserRole } from '@/phos/contracts/phos_contracts';

export function normalizePhosRole(value: unknown): PhosUserRole | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  return Object.values(UserRole).find((role) => role === normalized);
}

export function phosRoleFromMemberRole(role: MemberRole | string): PhosUserRole | null {
  switch (role) {
    case 'owner':
    case 'admin':
      return UserRole.ADMIN;
    case 'pharmacist':
    case 'pharmacist_trainee':
      return UserRole.PHARMACIST;
    case 'clerk':
      return UserRole.PHARMACY_CLERK;
    case 'driver':
      return UserRole.DISPENSE_ASSISTANT;
    case 'external_viewer':
      return null;
    default:
      return null;
  }
}
