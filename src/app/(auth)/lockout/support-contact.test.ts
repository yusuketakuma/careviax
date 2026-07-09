import { describe, expect, it } from 'vitest';
import { resolveSupportContact } from './support-contact';

describe('resolveSupportContact', () => {
  it('returns nulls and hasContact=false when nothing is configured', () => {
    expect(resolveSupportContact({})).toEqual({
      name: null,
      phone: null,
      email: null,
      hasContact: false,
    });
  });

  it('treats whitespace-only values as unset (no fabricated contact)', () => {
    expect(
      resolveSupportContact({
        NEXT_PUBLIC_SUPPORT_CONTACT_NAME: '  ',
        NEXT_PUBLIC_SUPPORT_CONTACT_PHONE: '',
        NEXT_PUBLIC_SUPPORT_CONTACT_EMAIL: '\t',
      }),
    ).toEqual({ name: null, phone: null, email: null, hasContact: false });
  });

  it('resolves the configured branch with trimmed values', () => {
    expect(
      resolveSupportContact({
        NEXT_PUBLIC_SUPPORT_CONTACT_NAME: ' 情報システム担当 ',
        NEXT_PUBLIC_SUPPORT_CONTACT_PHONE: ' 011-234-5678 ',
        NEXT_PUBLIC_SUPPORT_CONTACT_EMAIL: ' support@pharmacy.example.jp ',
      }),
    ).toEqual({
      name: '情報システム担当',
      phone: '011-234-5678',
      email: 'support@pharmacy.example.jp',
      hasContact: true,
    });
  });

  it('sets hasContact when only one channel is provided (name alone does not)', () => {
    expect(
      resolveSupportContact({ NEXT_PUBLIC_SUPPORT_CONTACT_EMAIL: 'a@b.example' }).hasContact,
    ).toBe(true);
    expect(resolveSupportContact({ NEXT_PUBLIC_SUPPORT_CONTACT_NAME: '管理部門' }).hasContact).toBe(
      false,
    );
  });
});
