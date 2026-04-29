export const BILLING_MONTH_FORMAT_MESSAGE = 'billing_month は YYYY-MM-01 形式で指定してください';

export type ParsedBillingMonth = {
  canonical: string;
  start: Date;
  nextStart: Date;
};

export function parseStrictBillingMonth(value: unknown): ParsedBillingMonth | null {
  if (typeof value !== 'string') return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day !== 1) return null;

  const canonical = `${yearText}-${monthText}-01`;
  const start = new Date(Date.UTC(year, month - 1, 1));
  if (start.toISOString().slice(0, 10) !== canonical) return null;

  const nextStart = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));

  return {
    canonical,
    start,
    nextStart,
  };
}
