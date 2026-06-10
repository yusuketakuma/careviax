export function formatDateKey(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatNullableDateKey(value: Date | null | undefined) {
  return value ? formatDateKey(value) : null;
}

export function formatUtcDateKey(value: Date) {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${value.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatNullableUtcDateKey(value: Date | null | undefined) {
  return value ? formatUtcDateKey(value) : null;
}
