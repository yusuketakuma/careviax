import { describe, expect, it } from 'vitest';
import { getSettingRangeError, SETTING_CATALOG } from './settings-catalog';

const sessionTimeout = SETTING_CATALOG.system.find(
  (item) => item.key === 'session_timeout_minutes',
)!;
const auditRetention = SETTING_CATALOG.system.find(
  (item) => item.key === 'audit_log_retention_days',
)!;
const passwordMinLength = SETTING_CATALOG.system.find(
  (item) => item.key === 'password_min_length',
)!;

describe('getSettingRangeError', () => {
  it('defines 3省2GL-aligned min/max for the compliance-affecting system settings', () => {
    expect(sessionTimeout).toMatchObject({ min: 5, max: 30 });
    expect(auditRetention).toMatchObject({ min: 365, max: 3650 });
    expect(passwordMinLength).toMatchObject({ min: 12, max: 128 });
  });

  it('returns null for non-number field types regardless of value', () => {
    expect(getSettingRangeError({ type: 'text', label: 'x' }, 'anything')).toBeNull();
    expect(getSettingRangeError({ type: 'boolean', label: 'x' }, 'true')).toBeNull();
    expect(getSettingRangeError({ type: 'select', label: 'x' }, 'a')).toBeNull();
  });

  it('returns null for number fields with no min/max configured', () => {
    expect(getSettingRangeError({ type: 'number', label: 'x' }, '999999')).toBeNull();
  });

  it('accepts the exact min and max boundary values (inclusive)', () => {
    expect(getSettingRangeError(sessionTimeout, '5')).toBeNull();
    expect(getSettingRangeError(sessionTimeout, '30')).toBeNull();
  });

  it('rejects one below the min boundary and one above the max boundary', () => {
    expect(getSettingRangeError(sessionTimeout, '4')).toContain('5');
    expect(getSettingRangeError(sessionTimeout, '31')).toContain('30');
  });

  it('rejects non-numeric and empty input with a validation message', () => {
    expect(getSettingRangeError(sessionTimeout, 'abc')).toContain('数値');
    expect(getSettingRangeError(sessionTimeout, '')).toContain('数値');
    expect(getSettingRangeError(sessionTimeout, '   ')).toContain('数値');
  });

  it('enforces the audit log retention min boundary (365 days)', () => {
    expect(getSettingRangeError(auditRetention, '364')).toContain('365');
    expect(getSettingRangeError(auditRetention, '365')).toBeNull();
  });

  it('enforces the password min length boundary (12 characters)', () => {
    expect(getSettingRangeError(passwordMinLength, '11')).toContain('12');
    expect(getSettingRangeError(passwordMinLength, '12')).toBeNull();
  });
});
