import { describe, expect, it } from 'vitest';
import {
  formatMedicationCalendarDayLabel,
  medicationCalendarColumnLabel,
  medicationCalendarSlotLabel,
} from './medication-calendar-content';

describe('medication calendar accessibility labels', () => {
  it('builds stable Japanese labels for weekday columns, dates, and slots', () => {
    expect(medicationCalendarColumnLabel(0)).toBe('日曜日');
    expect(medicationCalendarColumnLabel(6)).toBe('土曜日');
    expect(medicationCalendarColumnLabel(7)).toBe('曜日');
    expect(formatMedicationCalendarDayLabel('2026-03-01')).toBe('2026年3月1日 日曜日');
    expect(medicationCalendarSlotLabel('2026-03-01', 'morning')).toBe(
      '2026年3月1日 日曜日 朝の服薬',
    );
    expect(medicationCalendarSlotLabel('2026-03-01', 'bedtime')).toBe(
      '2026年3月1日 日曜日 眠前の服薬',
    );
  });

  it('does not include patient identifiers or medication names in structural labels', () => {
    const labels = [
      medicationCalendarColumnLabel(1),
      formatMedicationCalendarDayLabel('2026-03-02'),
      medicationCalendarSlotLabel('2026-03-02', 'evening'),
    ].join(' ');

    expect(labels).not.toMatch(/patient_|山田|太郎|アムロジピン|メトホルミン/);
  });
});
