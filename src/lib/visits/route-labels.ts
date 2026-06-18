import { format, parseISO } from 'date-fns';

function parseTimeOfDay(value: string | null | undefined) {
  if (!value) return null;
  const direct = value.match(/^(\d{2}:\d{2})(?::\d{2})?/);
  if (direct) return direct[1];

  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, 'HH:mm');
}

function parseTimeOfDayWithSeconds(value: string | null | undefined) {
  if (!value) return null;
  const direct = value.match(/^(\d{2}:\d{2})(?::(\d{2}))?/);
  if (direct) return `${direct[1]}:${direct[2] ?? '00'}`;

  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, 'HH:mm:ss');
}

export function formatMinutesLabel(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatDistanceLabel(value: number | null) {
  if (value == null) return '距離未取得';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}km`;
  return `${value}m`;
}

export function formatDurationLabel(value: number | null) {
  if (value == null) return '時間未取得';
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  if (hours > 0) return `${hours}時間${minutes}分`;
  return `${minutes}分`;
}

export function formatTimeWindowLabel(start: string | null, end: string | null) {
  const left = start ? (parseTimeOfDay(start) ?? '時間未定') : '時間未定';
  const right = end ? parseTimeOfDay(end) : null;
  return right ? `${left} - ${right}` : left;
}

export function formatNullableTimeOfDayLabel(value: string | null | undefined) {
  return parseTimeOfDay(value);
}

export function formatNullableTimeWindowLabel(
  start: string | null | undefined,
  end: string | null | undefined,
) {
  const left = parseTimeOfDay(start);
  const right = parseTimeOfDay(end);
  if (!left && !right) return null;
  if (left && right) return `${left} - ${right}`;
  return left ?? right;
}

export function formatEtaLabel(
  baseDate: string,
  departureTime: string | null,
  offsetSeconds: number | null,
  fallbackTime: string | null,
) {
  if (offsetSeconds == null) return fallbackTime ? formatTimeWindowLabel(fallbackTime, null) : null;
  const normalizedDepartureTime = parseTimeOfDayWithSeconds(departureTime) ?? '09:00:00';
  const base = parseISO(`${baseDate}T${normalizedDepartureTime}`);
  if (Number.isNaN(base.getTime()))
    return fallbackTime ? formatTimeWindowLabel(fallbackTime, null) : null;
  const shifted = new Date(base.getTime() + offsetSeconds * 1000);
  return format(shifted, 'HH:mm');
}
