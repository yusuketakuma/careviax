import { describe, expect, it } from 'vitest';
import { UserRole } from '@/phos/contracts/phos_contracts';
import { normalizePhosRole, phosRoleFromMemberRole } from './phos-role';

describe('normalizePhosRole', () => {
  it('normalizes canonical PH-OS role claims', () => {
    expect(normalizePhosRole(' pharmacist ')).toBe(UserRole.PHARMACIST);
    expect(normalizePhosRole('PHARMACY_CLERK')).toBe(UserRole.PHARMACY_CLERK);
    expect(normalizePhosRole('unknown')).toBeUndefined();
    expect(normalizePhosRole(null)).toBeUndefined();
  });
});

describe('phosRoleFromMemberRole', () => {
  it('maps persisted membership roles into PH-OS API roles', () => {
    expect(phosRoleFromMemberRole('owner')).toBe(UserRole.ADMIN);
    expect(phosRoleFromMemberRole('admin')).toBe(UserRole.ADMIN);
    expect(phosRoleFromMemberRole('pharmacist')).toBe(UserRole.PHARMACIST);
    expect(phosRoleFromMemberRole('pharmacist_trainee')).toBe(UserRole.PHARMACIST);
    expect(phosRoleFromMemberRole('clerk')).toBe(UserRole.PHARMACY_CLERK);
    expect(phosRoleFromMemberRole('driver')).toBe(UserRole.DISPENSE_ASSISTANT);
    expect(phosRoleFromMemberRole('external_viewer')).toBeNull();
  });
});
