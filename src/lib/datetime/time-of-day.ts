export function clockPartsToTimeDate(hours: number, minutes: number, seconds = 0): Date {
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    throw new RangeError('time of day must be valid clock parts');
  }

  return new Date(Date.UTC(1970, 0, 1, hours, minutes, seconds, 0));
}

export function hhmmToTimeDate(value: string): Date {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new RangeError('time of day must be HH:mm');
  }

  return clockPartsToTimeDate(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10));
}

export function clockStringToTimeDate(value: string): Date {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (!match) {
    throw new RangeError('time of day must be HH:mm or HH:mm:ss');
  }

  return clockPartsToTimeDate(
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    match[3] ? Number.parseInt(match[3], 10) : 0,
  );
}

export function formatTimeOfDay(value: string | Date): string {
  if (typeof value === 'string') {
    const direct = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/.exec(value);
    if (direct) return `${direct[1]}:${direct[2]}`;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}
