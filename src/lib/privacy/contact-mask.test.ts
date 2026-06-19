import { describe, expect, it } from 'vitest';
import { looksLikePhoneNumber, maskContactValueForAudit, maskPhoneContact } from './contact-mask';

describe('contact audit masking', () => {
  it('detects practical phone numbers', () => {
    expect(looksLikePhoneNumber('090-1234-5678')).toBe(true);
    expect(looksLikePhoneNumber('care@example.com')).toBe(false);
  });

  it('masks phone contacts with configurable leading digits', () => {
    expect(maskPhoneContact('090-1234-5678', { leadingDigits: 3 })).toBe('090****5678');
    expect(maskPhoneContact('03-1111-2222', { leadingDigits: 2 })).toBe('03****2222');
    expect(maskPhoneContact('03-1111-2222')).toBe('*******2222');
  });

  it('masks email and generic contacts for audit metadata', () => {
    expect(maskContactValueForAudit('doctor@example.com')).toBe('d***@example.com');
    expect(maskContactValueForAudit('abcd')).toBe('****');
    expect(maskContactValueForAudit('abcdef')).toBe('ab****ef');
  });
});
