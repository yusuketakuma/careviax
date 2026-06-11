import { describe, expect, it } from 'vitest';

import {
  DATE_LABEL_PLACEHOLDER,
  formatDateLabel,
  formatDateTimeLabel,
} from './date-format';

describe('formatDateLabel', () => {
  it('formats ISO date strings with the default pattern', () => {
    expect(formatDateLabel('2026-06-11')).toBe('2026/06/11');
    expect(formatDateLabel('2026-06-11T09:30:00+09:00')).toBe('2026/06/11');
  });

  it('returns the placeholder for empty values', () => {
    expect(formatDateLabel(null)).toBe(DATE_LABEL_PLACEHOLDER);
    expect(formatDateLabel(undefined)).toBe(DATE_LABEL_PLACEHOLDER);
    expect(formatDateLabel('')).toBe(DATE_LABEL_PLACEHOLDER);
  });

  it('honors a custom fallback', () => {
    expect(formatDateLabel(null, { fallback: '未設定' })).toBe('未設定');
  });

  it('honors a custom pattern', () => {
    expect(formatDateLabel('2026-06-01', { pattern: 'MM/dd' })).toBe('06/01');
    expect(formatDateLabel('2026-06-01', { pattern: 'yyyy/M/d' })).toBe('2026/6/1');
    expect(formatDateLabel('2026-06-01', { pattern: 'M月d日' })).toBe('6月1日');
  });

  it('returns the raw value for unparseable input instead of throwing', () => {
    expect(formatDateLabel('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateTimeLabel', () => {
  it('formats with date and time by default', () => {
    expect(formatDateTimeLabel('2026-06-11T09:05:00+09:00')).toBe('2026/06/11 09:05');
  });

  it('returns the placeholder for empty values', () => {
    expect(formatDateTimeLabel(null)).toBe(DATE_LABEL_PLACEHOLDER);
  });

  it('honors custom fallback and pattern overrides', () => {
    expect(formatDateTimeLabel(null, { fallback: '未記録' })).toBe('未記録');
    expect(
      formatDateTimeLabel('2026-06-11T09:05:00+09:00', { pattern: 'MM/dd HH:mm' }),
    ).toBe('06/11 09:05');
  });
});
