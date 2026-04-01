export const SET_METHOD_OPTIONS = [
  { value: 'facility_calendar', label: '施設カレンダー' },
  { value: 'four_times_daily', label: '1日4回' },
  { value: 'bedtime_only', label: '眠前のみ' },
  { value: 'custom', label: 'カスタム' },
] as const;

export type SetMethodValue = (typeof SET_METHOD_OPTIONS)[number]['value'];

export const SET_METHOD_LABELS = Object.fromEntries(
  SET_METHOD_OPTIONS.map((option) => [option.value, option.label])
) as Record<SetMethodValue, string>;
