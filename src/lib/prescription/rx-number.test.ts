// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { formatPrescriptionCardNumber } from './rx-number';

describe('formatPrescriptionCardNumber (rx_yearmonth: default)', () => {
  it('combines YYYYMM from prescribed_date and last 4 digits of id', () => {
    expect(formatPrescriptionCardNumber('abc1234', '2026-05-20')).toBe('RX-202605-1234');
  });

  it('zero-pads id tail when shorter than 4 digits', () => {
    expect(formatPrescriptionCardNumber('a9', '2026-01-01')).toBe('RX-202601-0009');
  });

  it('uses ?????? when prescribed_date is null', () => {
    expect(formatPrescriptionCardNumber('xyz9999', null)).toBe('RX-??????-9999');
  });

  it('uses ?????? when prescribed_date is undefined', () => {
    expect(formatPrescriptionCardNumber('xyz9999', undefined)).toBe('RX-??????-9999');
  });

  it('handles id with only non-numeric suffix by padding with X', () => {
    const result = formatPrescriptionCardNumber('abcd', '2026-03-15');
    expect(result).toMatch(/^RX-202603-/);
  });

  it('uses opaque full-id suffixes for long non-numeric ids to avoid collisions', () => {
    const first = formatPrescriptionCardNumber('cm0rxintake0001aaa', '2026-06-13');
    const second = formatPrescriptionCardNumber('cm0rxintake0001bbb', '2026-06-13');

    expect(first).toMatch(/^RX-202606-[A-Z0-9]{6}-CM0RXINTAKE0001AAA$/);
    expect(second).toMatch(/^RX-202606-[A-Z0-9]{6}-CM0RXINTAKE0001BBB$/);
    expect(first).not.toBe(second);
  });

  it('matches the explicit rx_yearmonth format (backward compatibility)', () => {
    expect(formatPrescriptionCardNumber('abc1234', '2026-05-20', 'rx_yearmonth')).toBe(
      formatPrescriptionCardNumber('abc1234', '2026-05-20'),
    );
  });
});

describe('formatPrescriptionCardNumber (rx_year)', () => {
  it('combines YYYY only and last 4 digits of id (new design notation)', () => {
    expect(formatPrescriptionCardNumber('cycle0500', '2024-06-01', 'rx_year')).toBe('RX-2024-0500');
  });

  it('zero-pads id tail when shorter than 4 digits', () => {
    expect(formatPrescriptionCardNumber('a9', '2026-01-01', 'rx_year')).toBe('RX-2026-0009');
  });

  it('uses ???? when prescribed_date is null', () => {
    expect(formatPrescriptionCardNumber('xyz9999', null, 'rx_year')).toBe('RX-????-9999');
  });

  it('uses ???? when prescribed_date is undefined', () => {
    expect(formatPrescriptionCardNumber('xyz9999', undefined, 'rx_year')).toBe('RX-????-9999');
  });

  it('handles id with only non-numeric suffix by padding with X', () => {
    const result = formatPrescriptionCardNumber('abcd', '2026-03-15', 'rx_year');
    expect(result).toMatch(/^RX-2026-/);
  });
});
