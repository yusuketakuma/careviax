export const MEDICATION_CALENDAR_SLOT_KEYS = ['morning', 'noon', 'evening', 'bedtime'] as const;
export type MedicationCalendarSlot = (typeof MEDICATION_CALENDAR_SLOT_KEYS)[number];

export const MEDICATION_CALENDAR_SLOT_LABELS: Record<MedicationCalendarSlot, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
};

export type MedicationCalendarProfile = {
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  start_date: Date | null;
  end_date: Date | null;
};

export function inferMedicationCalendarSlots(frequency?: string | null): MedicationCalendarSlot[] {
  const text = frequency ?? '';
  const slots = new Set<MedicationCalendarSlot>();

  if (text.includes('毎食')) {
    slots.add('morning');
    slots.add('noon');
    slots.add('evening');
  }
  if (text.includes('朝')) slots.add('morning');
  if (text.includes('昼')) slots.add('noon');
  if (text.includes('夕') || text.includes('夜')) slots.add('evening');
  if (text.includes('眠前') || text.includes('就寝')) slots.add('bedtime');

  if (slots.size === 0) {
    slots.add('morning');
  }

  return [...slots];
}

export function isMedicationActiveOnCalendarDate(
  profile: Pick<MedicationCalendarProfile, 'start_date' | 'end_date'>,
  date: Date,
) {
  const start = profile.start_date ? new Date(profile.start_date) : null;
  const end = profile.end_date ? new Date(profile.end_date) : null;
  const compare = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  if (start) {
    const startValue = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    if (compare < startValue) return false;
  }

  if (end) {
    const endValue = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    if (compare > endValue) return false;
  }

  return true;
}

export function enumerateMedicationCalendarMonthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const daysInMonth = last.getDate();
  const offset = first.getDay();
  const cells: Array<Date | null> = [];

  for (let index = 0; index < offset; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), day));
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

export function buildMedicationCalendarSlots(
  medications: MedicationCalendarProfile[],
  date: Date | null,
): Partial<Record<MedicationCalendarSlot, string[]>> {
  if (!date) return {};

  const slots: Partial<Record<MedicationCalendarSlot, string[]>> = {};

  for (const profile of medications) {
    if (!isMedicationActiveOnCalendarDate(profile, date)) continue;
    for (const slot of inferMedicationCalendarSlots(profile.frequency)) {
      if (!slots[slot]) {
        slots[slot] = [];
      }
      slots[slot].push([profile.drug_name, profile.dose].filter(Boolean).join(' '));
    }
  }

  return slots;
}
