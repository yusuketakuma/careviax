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

export function timeIsoToString(value: string | null | undefined) {
  if (!value) return undefined;
  const direct = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/);
  if (direct) return `${direct[1]}:${direct[2]}`;
  const isoClock = value.match(
    /T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (isoClock) return `${isoClock[1]}:${isoClock[2]}`;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return timeDateToString(parsed);
}

export function timeIsoToMinutes(value: string | null | undefined) {
  if (!value) return null;
  const direct = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/);
  if (direct) return Number(direct[1]) * 60 + Number(direct[2]);
  const isoClock = value.match(
    /T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (isoClock) return Number(isoClock[1]) * 60 + Number(isoClock[2]);

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return timeDateToMinutes(parsed);
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
