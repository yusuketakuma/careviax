export const DEFAULT_PRESCRIPTION_TIME_ZONE = 'Asia/Tokyo';
export const PRESCRIPTION_VALID_DAYS_AFTER_ISSUE = 4;

export type PrescriptionDateWindowResult =
  | { ok: true }
  | { ok: false; reason: 'future_prescribed_date' | 'expiry_exceeded' };

function formatDateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Failed to format prescription date key');
  }
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function validatePrescriptionDateWindow(
  prescribedDateKey: string,
  now: Date = new Date(),
  timeZone = DEFAULT_PRESCRIPTION_TIME_ZONE,
): PrescriptionDateWindowResult {
  const todayKey = formatDateKeyInTimeZone(now, timeZone);
  if (prescribedDateKey > todayKey) {
    return { ok: false, reason: 'future_prescribed_date' };
  }

  const lastValidDateKey = addDaysToDateKey(prescribedDateKey, PRESCRIPTION_VALID_DAYS_AFTER_ISSUE);
  if (todayKey > lastValidDateKey) {
    return { ok: false, reason: 'expiry_exceeded' };
  }

  return { ok: true };
}
