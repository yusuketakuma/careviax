import { describe, expect, it } from 'vitest';
import {
  buildMedicationCalendarSlots,
  enumerateMedicationCalendarMonthDays,
  inferMedicationCalendarSlots,
  isMedicationActiveOnCalendarDate,
  type MedicationCalendarProfile,
} from '@/server/services/pdf-medication-calendar';

describe('pdf medication calendar helpers', () => {
  it('infers medication slots from Japanese frequency labels', () => {
    expect(inferMedicationCalendarSlots('毎食後 眠前')).toEqual([
      'morning',
      'noon',
      'evening',
      'bedtime',
    ]);
    expect(inferMedicationCalendarSlots('朝夕')).toEqual(['morning', 'evening']);
    expect(inferMedicationCalendarSlots('就寝前')).toEqual(['bedtime']);
  });

  it('defaults unknown frequency labels to morning', () => {
    expect(inferMedicationCalendarSlots(null)).toEqual(['morning']);
    expect(inferMedicationCalendarSlots('頓服')).toEqual(['morning']);
  });

  it('checks medication activity by inclusive calendar dates', () => {
    const profile = {
      start_date: new Date(2026, 3, 10, 23, 30),
      end_date: new Date(2026, 3, 12, 1, 30),
    };

    expect(isMedicationActiveOnCalendarDate(profile, new Date(2026, 3, 9))).toBe(false);
    expect(isMedicationActiveOnCalendarDate(profile, new Date(2026, 3, 10))).toBe(true);
    expect(isMedicationActiveOnCalendarDate(profile, new Date(2026, 3, 12))).toBe(true);
    expect(isMedicationActiveOnCalendarDate(profile, new Date(2026, 3, 13))).toBe(false);
  });

  it('enumerates month cells with leading and trailing empty days', () => {
    const cells = enumerateMedicationCalendarMonthDays(new Date(2026, 3, 1));

    expect(cells).toHaveLength(35);
    expect(cells.slice(0, 3)).toEqual([null, null, null]);
    expect(cells[3]?.getDate()).toBe(1);
    expect(cells[32]?.getDate()).toBe(30);
    expect(cells.slice(33)).toEqual([null, null]);
  });

  it('builds per-slot medication labels only for active medications', () => {
    const medications: MedicationCalendarProfile[] = [
      {
        drug_name: '朝昼夕薬',
        dose: '1錠',
        frequency: '毎食後',
        start_date: new Date(2026, 3, 1),
        end_date: null,
      },
      {
        drug_name: '眠前薬',
        dose: null,
        frequency: '眠前',
        start_date: new Date(2026, 3, 10),
        end_date: new Date(2026, 3, 20),
      },
      {
        drug_name: '終了薬',
        dose: '2錠',
        frequency: '朝',
        start_date: new Date(2026, 2, 1),
        end_date: new Date(2026, 3, 9),
      },
    ];

    expect(buildMedicationCalendarSlots(medications, null)).toEqual({});
    expect(buildMedicationCalendarSlots(medications, new Date(2026, 3, 10))).toEqual({
      morning: ['朝昼夕薬 1錠'],
      noon: ['朝昼夕薬 1錠'],
      evening: ['朝昼夕薬 1錠'],
      bedtime: ['眠前薬'],
    });
  });
});
