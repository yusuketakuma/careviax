import { describe, expect, it } from 'vitest';
import {
  formatDistanceLabel,
  formatDurationLabel,
  formatEtaLabel,
  formatNullableTimeOfDayLabel,
  formatNullableTimeWindowLabel,
  formatTimeWindowLabel,
} from './route-labels';

describe('visit route labels', () => {
  it('formats distance and duration labels', () => {
    expect(formatDistanceLabel(null)).toBe('距離未取得');
    expect(formatDistanceLabel(850)).toBe('850m');
    expect(formatDistanceLabel(1250)).toBe('1.3km');

    expect(formatDurationLabel(null)).toBe('時間未取得');
    expect(formatDurationLabel(1500)).toBe('25分');
    expect(formatDurationLabel(5400)).toBe('1時間30分');
  });

  it('formats time windows from ISO and HH:mm inputs', () => {
    expect(formatNullableTimeOfDayLabel(null)).toBeNull();
    expect(formatNullableTimeOfDayLabel('2026-04-01T08:45:00')).toBe('08:45');
    expect(formatNullableTimeOfDayLabel('1970-01-01T09:00:00.000Z')).toBe('09:00');
    expect(formatNullableTimeOfDayLabel('1970-01-01T09:00:00.000+09:00')).toBe('09:00');
    expect(formatNullableTimeOfDayLabel('1970-01-01T09:00:00.000-08:00')).toBe('09:00');
    expect(formatNullableTimeOfDayLabel('1970-01-01T09:00:00.000-0800')).toBe('09:00');
    expect(formatTimeWindowLabel('2026-04-01T09:00:00', '2026-04-01T09:30:00')).toBe(
      '09:00 - 09:30',
    );
    expect(formatTimeWindowLabel('1970-01-01T09:00:00.000Z', '1970-01-01T10:30:00.000Z')).toBe(
      '09:00 - 10:30',
    );
    expect(
      formatTimeWindowLabel('1970-01-01T09:00:00.000-08:00', '1970-01-01T10:30:00.000-0800'),
    ).toBe('09:00 - 10:30');
    expect(formatTimeWindowLabel('10:15', null)).toBe('10:15');
    expect(formatNullableTimeWindowLabel(null, undefined)).toBeNull();
    expect(formatNullableTimeWindowLabel(null, '10:30')).toBe('10:30');
    expect(formatNullableTimeWindowLabel(null, '1970-01-01T10:30:00.000Z')).toBe('10:30');
    expect(formatNullableTimeWindowLabel('10:15', '10:45')).toBe('10:15 - 10:45');
  });

  it('formats ETA from a selected departure time and falls back to the original time', () => {
    expect(formatEtaLabel('2026-04-01', '2026-04-01T08:30:00', 1800, null)).toBe('09:00');
    expect(formatEtaLabel('2026-04-01', null, 900, null)).toBe('09:15');
    expect(formatEtaLabel('invalid', null, 900, '2026-04-01T10:00:00')).toBe('10:00');
    expect(formatEtaLabel('2026-04-01', null, null, '11:30')).toBe('11:30');
  });
});
