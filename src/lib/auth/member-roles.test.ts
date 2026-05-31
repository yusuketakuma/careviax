import { describe, expect, it } from 'vitest';
import {
  ADMIN_MEMBER_ROLES,
  DISPENSE_AUDIT_FALLBACK_MEMBER_ROLES,
  MANAGEABLE_MEMBER_ROLES,
  MEMBER_ROLES,
  isMemberRole,
  isCollaboratorRole,
  isOperationalMemberRole,
  memberRoleLabel,
  membershipFlagsForRole,
  roleRequiresSite,
} from './member-roles';

describe('member-roles', () => {
  describe('membershipFlagsForRole', () => {
    it('grants full dispense and audit rights to owner', () => {
      expect(membershipFlagsForRole('owner')).toEqual({
        can_dispense: true,
        can_set: true,
        can_audit_dispense: true,
        can_audit_set: true,
      });
    });

    it('grants full dispense and audit rights to admin', () => {
      expect(membershipFlagsForRole('admin')).toEqual({
        can_dispense: true,
        can_set: true,
        can_audit_dispense: true,
        can_audit_set: true,
      });
    });

    it('grants dispense to pharmacist but not audit', () => {
      expect(membershipFlagsForRole('pharmacist')).toEqual({
        can_dispense: true,
        can_set: true,
        can_audit_dispense: false,
        can_audit_set: false,
      });
    });

    it('grants dispense to pharmacist_trainee without audit rights', () => {
      const flags = membershipFlagsForRole('pharmacist_trainee');
      expect(flags.can_dispense).toBe(true);
      expect(flags.can_audit_dispense).toBe(false);
    });

    it('denies all dispense rights to clerk, driver, external_viewer', () => {
      for (const role of ['clerk', 'driver', 'external_viewer'] as const) {
        expect(membershipFlagsForRole(role)).toEqual({
          can_dispense: false,
          can_set: false,
          can_audit_dispense: false,
          can_audit_set: false,
        });
      }
    });
  });

  describe('isOperationalMemberRole', () => {
    it.each([
      ['owner', true],
      ['admin', true],
      ['pharmacist', true],
      ['pharmacist_trainee', true],
      ['clerk', false],
      ['driver', false],
      ['external_viewer', false],
      ['unknown', false],
    ])('classifies %s as operational=%s', (role, expected) => {
      expect(isOperationalMemberRole(role)).toBe(expected);
    });
  });

  describe('isCollaboratorRole', () => {
    it.each([
      ['clerk', true],
      ['driver', true],
      ['external_viewer', true],
      ['pharmacist', false],
      ['admin', false],
      ['owner', false],
    ])('classifies %s as collaborator=%s', (role, expected) => {
      expect(isCollaboratorRole(role)).toBe(expected);
    });
  });

  describe('roleRequiresSite', () => {
    it('returns false only for external_viewer', () => {
      expect(roleRequiresSite('external_viewer')).toBe(false);
      for (const role of ['owner', 'admin', 'pharmacist', 'driver', 'clerk'] as const) {
        expect(roleRequiresSite(role)).toBe(true);
      }
    });
  });

  describe('memberRoleLabel', () => {
    it('returns Japanese labels for known roles', () => {
      expect(memberRoleLabel('owner')).toBe('責任者');
      expect(memberRoleLabel('admin')).toBe('管理者');
      expect(memberRoleLabel('pharmacist')).toBe('薬剤師');
      expect(memberRoleLabel('pharmacist_trainee')).toBe('研修薬剤師');
      expect(memberRoleLabel('clerk')).toBe('事務スタッフ');
      expect(memberRoleLabel('driver')).toBe('配送担当');
      expect(memberRoleLabel('external_viewer')).toBe('外部連携者');
    });

    it('passes through unknown role strings unchanged', () => {
      expect(memberRoleLabel('mystery_role')).toBe('mystery_role');
    });
  });

  describe('MANAGEABLE_MEMBER_ROLES', () => {
    it('does not include owner (owner is provisioned separately)', () => {
      expect(MANAGEABLE_MEMBER_ROLES).not.toContain('owner');
    });

    it('contains the expected six roles', () => {
      expect([...MANAGEABLE_MEMBER_ROLES]).toEqual([
        'admin',
        'pharmacist',
        'pharmacist_trainee',
        'clerk',
        'driver',
        'external_viewer',
      ]);
    });
  });

  describe('MEMBER_ROLES', () => {
    it('contains every persisted membership role', () => {
      expect([...MEMBER_ROLES]).toEqual([
        'owner',
        'admin',
        'pharmacist',
        'pharmacist_trainee',
        'clerk',
        'driver',
        'external_viewer',
      ]);
    });

    it('narrows unknown values to persisted membership roles', () => {
      expect(isMemberRole('owner')).toBe(true);
      expect(isMemberRole('physician')).toBe(false);
      expect(isMemberRole(null)).toBe(false);
    });
  });

  describe('ADMIN_MEMBER_ROLES', () => {
    it('contains only owner and admin bypass roles', () => {
      expect([...ADMIN_MEMBER_ROLES]).toEqual(['owner', 'admin']);
    });
  });

  describe('DISPENSE_AUDIT_FALLBACK_MEMBER_ROLES', () => {
    it('contains the operational fallback roles for rejected dispense audits', () => {
      expect([...DISPENSE_AUDIT_FALLBACK_MEMBER_ROLES]).toEqual(['admin', 'pharmacist']);
    });
  });
});
