import {
  eachDayOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from 'date-fns';

export type Pharmacist = {
  id: string;
  name: string;
  name_kana: string | null;
  email: string;
  phone: string | null;
  role: 'pharmacist' | 'pharmacist_trainee' | 'owner' | 'admin';
  site_id: string | null;
  site_name: string | null;
  is_active: boolean;
  account_status: 'invited' | 'active' | 'suspended' | 'retired';
  invited_at: string | null;
  last_invited_at: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  max_daily_visits: number | null;
  max_weekly_visits: number | null;
  max_travel_minutes: number | null;
  can_accept_emergency: boolean;
  visit_specialties: string[] | null;
  coverage_area: string[] | null;
};

export type PharmacySite = {
  id: string;
  name: string;
  address: string;
};

export type ShiftRecord = {
  id: string;
  site_id: string;
  user_id: string;
  date: string;
  available: boolean;
  available_from: string | null;
  available_to: string | null;
  note: string | null;
  user: {
    id: string;
    name: string;
    name_kana: string | null;
  };
  site: {
    id: string;
    name: string;
  } | null;
};

export type ShiftCell = {
  id: string | null;
  key: string;
  user_id: string;
  user_name: string;
  site_id: string;
  site_name: string | null;
  date: string;
  available: boolean;
  available_from: string;
  available_to: string;
  note: string;
};

export type BusinessHoliday = {
  id: string;
  site_id: string | null;
  date: string;
  name: string;
  holiday_type: 'public_holiday' | 'site_closure' | 'org_event';
  is_closed: boolean;
  site: {
    id: string;
    name: string;
  } | null;
};

export type ShiftTemplate = {
  id: string;
  user_id: string;
  site_id: string;
  weekday: number;
  available: boolean;
  available_from: string | null;
  available_to: string | null;
  note: string | null;
  user: {
    id: string;
    name: string;
  };
  site: {
    id: string;
    name: string;
  } | null;
};

export type PharmacistAction = 'suspend' | 'reactivate' | 'resend_invite' | 'retire';

export const WEEKDAY_OPTIONS = [
  { value: '0', label: '日曜日' },
  { value: '1', label: '月曜日' },
  { value: '2', label: '火曜日' },
  { value: '3', label: '水曜日' },
  { value: '4', label: '木曜日' },
  { value: '5', label: '金曜日' },
  { value: '6', label: '土曜日' },
] as const;

export function toDateKey(value: string) {
  return value.slice(0, 10);
}

export function toTimeValue(value: string | null) {
  return value ? format(parseISO(value), 'HH:mm') : '';
}

export function cellKey(userId: string, date: string) {
  return `${userId}:${date}`;
}

export function parseListInput(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatListInput(values: string[] | null | undefined) {
  return values?.join('\n') ?? '';
}

export function toOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatCapacitySummary(pharmacist: Pharmacist) {
  const parts = [
    `日次 ${pharmacist.max_daily_visits ?? '未設定'}件`,
    `週次 ${pharmacist.max_weekly_visits ?? '未設定'}件`,
    `移動 ${pharmacist.max_travel_minutes ?? '未設定'}分`,
  ];
  parts.push(pharmacist.can_accept_emergency ? '緊急対応可' : '緊急対応不可');
  return parts.join(' / ');
}

export function weekdayLabel(weekday: number) {
  return WEEKDAY_OPTIONS.find((option) => Number(option.value) === weekday)?.label ?? `${weekday}`;
}

export function buildShiftGrid(args: {
  pharmacists: Pharmacist[];
  sitesById: Map<string, PharmacySite>;
  month: Date;
  shifts: ShiftRecord[];
}) {
  const days = eachDayOfInterval({
    start: startOfMonth(args.month),
    end: endOfMonth(args.month),
  });
  const shiftByKey = new Map(
    args.shifts.map((shift) => [cellKey(shift.user_id, toDateKey(shift.date)), shift]),
  );

  const cells: ShiftCell[] = [];
  for (const pharmacist of args.pharmacists) {
    for (const day of days) {
      const date = format(day, 'yyyy-MM-dd');
      const shift = shiftByKey.get(cellKey(pharmacist.id, date));
      const defaultSite = pharmacist.site_id
        ? (args.sitesById.get(pharmacist.site_id) ?? null)
        : null;

      cells.push({
        id: shift?.id ?? null,
        key: cellKey(pharmacist.id, date),
        user_id: pharmacist.id,
        user_name: pharmacist.name,
        site_id: shift?.site_id ?? pharmacist.site_id ?? '',
        site_name: shift?.site?.name ?? pharmacist.site_name ?? defaultSite?.name ?? null,
        date,
        available: shift?.available ?? false,
        available_from: toTimeValue(shift?.available_from ?? null) || '09:00',
        available_to: toTimeValue(shift?.available_to ?? null) || '18:00',
        note: shift?.note ?? '',
      });
    }
  }

  return cells;
}

export function holidayAppliesToSite(holiday: BusinessHoliday, siteId: string) {
  return holiday.site_id == null || holiday.site_id === siteId;
}

export function pharmacistStatusLabel(status: Pharmacist['account_status']) {
  switch (status) {
    case 'invited':
      return '招待中';
    case 'active':
      return '稼働中';
    case 'suspended':
      return '停止中';
    case 'retired':
      return '退職';
    default:
      return status;
  }
}

export function pharmacistStatusClass(status: Pharmacist['account_status']) {
  switch (status) {
    case 'active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'invited':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    case 'suspended':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'retired':
      return 'border-slate-200 bg-slate-100 text-slate-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}
