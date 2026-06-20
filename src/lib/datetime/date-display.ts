export function formatDateDisplay(value: string | null | undefined): string {
  if (!value) return '-';
  return value.slice(0, 10);
}
