export const MAX_SET_PLAN_DAY_COUNT = 35;

export function countInclusiveDateKeys(start: string, end: string): number {
  const startDate = dateKeyToUtcDate(start);
  const endDate = dateKeyToUtcDate(end);
  if (!startDate || !endDate) return Number.NaN;
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

export function isSetPlanPeriodWithinLimit(start: string, end: string): boolean {
  const dayCount = countInclusiveDateKeys(start, end);
  return Number.isFinite(dayCount) && dayCount >= 1 && dayCount <= MAX_SET_PLAN_DAY_COUNT;
}

function dateKeyToUtcDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
