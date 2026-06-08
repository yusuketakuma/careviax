export function timeDateToClockParts(value: Date) {
  return {
    hours: value.getUTCHours(),
    minutes: value.getUTCMinutes(),
  };
}

export function timeDateToString(value: Date | null | undefined) {
  if (!value) return undefined;
  const { hours, minutes } = timeDateToClockParts(value);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function timeDateToMinutes(value: Date | null | undefined) {
  if (!value) return null;
  const { hours, minutes } = timeDateToClockParts(value);
  return hours * 60 + minutes;
}

export function applyTimeDateToDate(
  baseDate: Date,
  timeLike: Date | null | undefined,
  fallback: string,
) {
  const [fallbackHour, fallbackMinute] = fallback.split(':').map(Number);
  const result = new Date(baseDate);
  if (!timeLike) {
    result.setHours(fallbackHour, fallbackMinute, 0, 0);
    return result;
  }

  const { hours, minutes } = timeDateToClockParts(timeLike);
  result.setHours(hours, minutes, 0, 0);
  return result;
}
